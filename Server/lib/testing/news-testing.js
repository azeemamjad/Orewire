/**
 * News-release testing harness (Admin → Testing → News Releases).
 *
 * Mirrors the filings harness but the unit is a COMPANY: pick N random companies
 * that have news releases, run each company's news items through the enrichment
 * prompt (editable + model-selectable), show the enriched output, and export a
 * zip. Tested companies are remembered in news_test_runs so the picker only ever
 * surfaces new ones.
 */
const db = require('../../db');
const { chatWithSystem } = require('../ai/client');
const { NEWS_SYSTEM } = require('../news/fetch');
const { buildZip } = require('./zip');

const DEFAULT_COMPANY_SAMPLE = 10;
const MAX_COMPANY_SAMPLE = 200;
const ITEMS_PER_COMPANY = 8;
/** LIVE production prompt (read by lib/news/fetch.js). */
const PROMPT_KEY = 'testing_news_prompt';
/** Testing-only draft — never used by production until promoted. */
const DRAFT_PROMPT_KEY = 'testing_news_prompt_draft';

// Real-time fetch (Newsfile / ASX) only covers these exchanges, so the pool is
// scoped to companies we can actually pull official releases for. Alias-agnostic
// callers substitute their column reference.
const FETCHABLE_EXCHANGES = ['TSX', 'TSXV', 'CSE', 'ASX'];

function getDefaultPrompt() {
  return NEWS_SYSTEM;
}

// ── Editable prompt (persisted in app_settings) ─────────────────────────────

async function readPromptValue(key) {
  try {
    const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    const v = r.rows[0]?.value;
    if (v && typeof v.prompt === 'string' && v.prompt.trim()) return v.prompt;
  } catch { /* fall through */ }
  return null;
}

async function writePromptValue(key, prompt) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify({ prompt: String(prompt ?? '') })],
  );
}

/** LIVE production prompt (custom or null). */
async function getProductionPrompt() {
  return readPromptValue(PROMPT_KEY);
}

/** Testing draft prompt, or null. */
async function getDraftPrompt() {
  return readPromptValue(DRAFT_PROMPT_KEY);
}

/** Effective production system prompt. */
async function getActivePrompt() {
  return (await getProductionPrompt()) || NEWS_SYSTEM;
}

async function isPromptCustom() {
  try {
    const r = await db.query(`SELECT 1 FROM app_settings WHERE key = $1`, [PROMPT_KEY]);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/** @deprecated prefer saveDraftPrompt / saveProductionPrompt */
async function saveTestingPrompt(prompt) {
  await writePromptValue(PROMPT_KEY, prompt);
}

async function saveDraftPrompt(prompt) {
  await writePromptValue(DRAFT_PROMPT_KEY, prompt);
}

async function saveProductionPrompt(prompt) {
  await writePromptValue(PROMPT_KEY, prompt);
  await db.query(`DELETE FROM app_settings WHERE key = $1`, [DRAFT_PROMPT_KEY]);
}

/** Payload for the Testing → News prompt editor (mirrors filings). */
async function buildNewsPromptPayload() {
  const [productionPrompt, draftPrompt, isProductionCustom] = await Promise.all([
    getProductionPrompt(),
    getDraftPrompt(),
    isPromptCustom(),
  ]);
  const defaultPrompt = getDefaultPrompt();
  const source = draftPrompt ? 'draft' : (productionPrompt ? 'production' : 'default');
  return {
    defaultPrompt,
    productionPrompt: productionPrompt || null,
    draftPrompt: draftPrompt || null,
    isProductionCustom,
    hasDraft: !!draftPrompt,
    prompt: draftPrompt || productionPrompt || defaultPrompt,
    source,
    isCustom: isProductionCustom,
  };
}

// ── Selection & tracking ────────────────────────────────────────────────────

/**
 * Random untested companies on a fetchable exchange — NOT limited to ones that
 * already have stored releases. Companies with news_count = 0 get their releases
 * pulled in real-time at analysis time (see fetchCompanyReleasesRealtime).
 */
async function pickUntestedCompanies(limit = DEFAULT_COMPANY_SAMPLE) {
  const n = Math.max(1, Math.min(MAX_COMPANY_SAMPLE, parseInt(limit, 10) || DEFAULT_COMPANY_SAMPLE));
  const r = await db.query(
    `SELECT c.id, c.name, c.ticker, c.exchange, COUNT(n.id)::int AS news_count
       FROM companies c
       LEFT JOIN news_releases n ON n.company_id = c.id
      WHERE c.ticker IS NOT NULL AND c.ticker <> ''
        AND UPPER(REPLACE(COALESCE(c.exchange, ''), '-', '')) = ANY($2::text[])
        AND c.id NOT IN (SELECT DISTINCT company_id FROM news_test_runs WHERE company_id IS NOT NULL)
      GROUP BY c.id
      ORDER BY random()
      LIMIT $1`,
    [n, FETCHABLE_EXCHANGES],
  );
  return r.rows;
}

async function getCompanyById(id) {
  const r = await db.query(`SELECT id, name, ticker, exchange FROM companies WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/** Recent news-release items for a company (title + description feed the prompt). */
async function getCompanyNewsItems(companyId, limit = ITEMS_PER_COMPANY) {
  const r = await db.query(
    `SELECT id, title, description, link, pub_date, source
       FROM news_releases
      WHERE company_id = $1
      ORDER BY pub_date DESC NULLS LAST
      LIMIT $2`,
    [companyId, limit],
  );
  return r.rows;
}

/**
 * Real-time fetch step: pull a company's official releases from Newsfile/ASX and
 * store them in news_releases. Used when the DB has none yet. Skips the
 * production AI enrichment (the test run enriches separately). Never throws.
 * @returns {Promise<{inserted:number, source:string|null, error:string|null}>}
 */
async function fetchCompanyReleasesRealtime(company) {
  try {
    const { syncOfficialCompanyReleases } = require('../news/official-releases');
    const res = await syncOfficialCompanyReleases(
      { name: company.name, ticker: company.ticker, exchange: company.exchange, companyId: company.id },
      { enrich: false },
    );
    return { inserted: res.inserted || 0, source: res.source || null, error: res.error || null };
  } catch (err) {
    return { inserted: 0, source: null, error: err?.message || String(err) };
  }
}

async function newsTestedStats() {
  const [tested, runs, total] = await Promise.all([
    db.query(`SELECT COUNT(DISTINCT company_id)::int AS n FROM news_test_runs WHERE company_id IS NOT NULL`),
    db.query(`SELECT COUNT(*)::int AS n FROM news_test_runs`),
    db.query(
      `SELECT COUNT(*)::int AS n FROM companies
        WHERE ticker IS NOT NULL AND ticker <> ''
          AND UPPER(REPLACE(COALESCE(exchange, ''), '-', '')) = ANY($1::text[])`,
      [FETCHABLE_EXCHANGES],
    ),
  ]);
  const testedCompanies = tested.rows[0]?.n || 0;
  const totalCompanies = total.rows[0]?.n || 0;
  return {
    testedCompanies,
    totalRuns: runs.rows[0]?.n || 0,
    totalCompanies,
    untested: Math.max(0, totalCompanies - testedCompanies),
  };
}

/**
 * Clear tested history so companies with news releases can be tested again
 * ("start from the start"), matching the Filings tab. Returns rows removed.
 */
async function resetNewsTestRuns() {
  const r = await db.query(`DELETE FROM news_test_runs`);
  return r.rowCount || 0;
}

async function recordNewsTestRun(companyId, {
  batchId, companyName, ticker, model, ok, itemCount,
  durationMs, promptTokens, completionTokens, results, errorMessage,
} = {}) {
  await db.query(
    `INSERT INTO news_test_runs
       (batch_id, company_id, company_name, ticker, model, ok, item_count,
        duration_ms, prompt_tokens, completion_tokens, results, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
    [
      batchId || null,
      companyId,
      companyName || null,
      ticker || null,
      model || null,
      ok !== false,
      Number.isFinite(itemCount) ? itemCount : null,
      Number.isFinite(durationMs) ? durationMs : null,
      Number.isFinite(promptTokens) ? promptTokens : null,
      Number.isFinite(completionTokens) ? completionTokens : null,
      results ? JSON.stringify(results) : null,
      errorMessage || null,
    ],
  );
}

async function getNewsBatchRuns(batchId) {
  const r = await db.query(
    `SELECT company_id, company_name, ticker, model, ok, item_count,
            duration_ms, prompt_tokens, completion_tokens, results, error_message
       FROM news_test_runs
      WHERE batch_id = $1
      ORDER BY id ASC`,
    [batchId],
  );
  return r.rows;
}

// ── Analysis ────────────────────────────────────────────────────────────────

function parseJson(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Enrich one company's news items with the (editable) news prompt. Matches the
 * production format: a numbered "title — description" list in, a JSON array out.
 * Returns { ok, items, ... } — never throws for expected failures.
 */
async function analyzeCompanyNews({ company, items, prompt, model, timeoutMs = 120000 }) {
  const started = Date.now();
  if (!items || items.length === 0) {
    return { ok: false, error: 'No news releases for this company', items: [], durationMs: 0 };
  }

  const userPrompt = items
    .map((r, i) => `${i + 1}. "${r.title}" — ${r.description || 'No description'}`)
    .join('\n');

  let resp;
  try {
    resp = await chatWithSystem({
      feature: 'news_enrichment_test',
      system: prompt && String(prompt).trim() ? String(prompt) : NEWS_SYSTEM,
      user: userPrompt,
      model: model || undefined,
      timeoutMs,
      bypassPause: true,
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err), items: [], durationMs: Date.now() - started };
  }

  let arr;
  try {
    arr = parseJson(resp.content);
    if (!Array.isArray(arr)) throw new Error('not an array');
  } catch {
    return {
      ok: false,
      error: 'Model did not return a JSON array',
      raw: (resp.content || '').slice(0, 4000),
      items: [],
      model: resp.model,
      durationMs: Date.now() - started,
      promptTokens: resp.promptTokens,
      completionTokens: resp.completionTokens,
    };
  }

  const enriched = items.map((src, i) => {
    const ai = arr[i] || {};
    return {
      n: i + 1,
      id: src.id || null,
      original_title: src.title,
      // Full release text fed to the prompt — kept for audit / ZIP export.
      description: src.description || null,
      link: src.link || null,
      source: src.source || null,
      pub_date: src.pub_date || null,
      title: ai.title || src.title,
      summary: ai.summary || null,
      commodity: ai.commodity || null,
      sentiment: ai.sentiment || null,
    };
  });

  return {
    ok: true,
    items: enriched,
    itemCount: enriched.length,
    model: resp.model,
    durationMs: Date.now() - started,
    promptTokens: resp.promptTokens,
    completionTokens: resp.completionTokens,
  };
}

// ── CSV / zip export ─────────────────────────────────────────────────────────

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function itemsToCsv(items) {
  const lines = ['n,source,pub_date,original_title,description,title,summary,commodity,sentiment,link'];
  for (const it of items || []) {
    lines.push([
      it.n, it.source, it.pub_date, it.original_title, it.description,
      it.title, it.summary, it.commodity, it.sentiment, it.link,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

/** Side-by-side audit CSV: news release text vs enriched output. */
function comparisonCsv(items) {
  const lines = [
    'n,source,pub_date,original_title,news_release,enriched_title,summary,commodity,sentiment,link',
  ];
  for (const it of items || []) {
    lines.push([
      it.n, it.source, it.pub_date, it.original_title, it.description,
      it.title, it.summary, it.commodity, it.sentiment, it.link,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

function sourceReleasesJson(items) {
  return (items || []).map((it) => ({
    n: it.n,
    id: it.id || null,
    source: it.source || null,
    pub_date: it.pub_date || null,
    title: it.original_title || it.title || null,
    description: it.description || null,
    link: it.link || null,
  }));
}

/** Human-readable original releases for easy prompt auditing. */
function sourcesToTxt(items) {
  return (items || []).map((it, i) => {
    const n = it.n || i + 1;
    return [
      `=== Release ${n} ===`,
      `Source: ${it.source || '—'}`,
      `Date: ${it.pub_date || '—'}`,
      `Link: ${it.link || '—'}`,
      `Title: ${it.original_title || it.title || '—'}`,
      '',
      it.description || '(no description stored)',
      '',
    ].join('\n');
  }).join('\n');
}

/**
 * Older runs may lack `description` on stored results. Best-effort backfill
 * from news_releases so ZIP downloads still include the source text.
 */
async function backfillItemDescriptions(companyId, items) {
  if (!Array.isArray(items) || !items.length || !companyId) return items;
  if (items.every((it) => it.description != null && String(it.description).trim() !== '')) {
    return items;
  }
  let sources;
  try {
    sources = await getCompanyNewsItems(companyId, Math.max(items.length, ITEMS_PER_COMPANY));
  } catch {
    return items;
  }
  if (!sources.length) return items;

  const byId = new Map(sources.map((s) => [String(s.id), s]));
  const byLink = new Map(
    sources.filter((s) => s.link).map((s) => [String(s.link), s]),
  );

  return items.map((it, i) => {
    if (it.description != null && String(it.description).trim() !== '') return it;
    const match = (it.id != null && byId.get(String(it.id)))
      || (it.link && byLink.get(String(it.link)))
      || sources[i]
      || null;
    if (!match) return it;
    return {
      ...it,
      id: it.id || match.id || null,
      description: match.description || null,
      pub_date: it.pub_date || match.pub_date || null,
      original_title: it.original_title || match.title || null,
      source: it.source || match.source || null,
      link: it.link || match.link || null,
    };
  });
}

function slugify(s) {
  return String(s || 'company').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'company';
}

function summaryCsv(results) {
  const lines = ['index,company_id,company,ticker,model,ok,items,duration_ms,prompt_tokens,completion_tokens,error'];
  results.forEach((r, i) => {
    lines.push([
      i + 1, r.companyId, r.company_name, r.ticker, r.model, r.ok !== false,
      r.itemCount || (r.items ? r.items.length : 0), r.durationMs || '',
      r.promptTokens ?? '', r.completionTokens ?? '', r.ok === false ? (r.error || '') : '',
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

/** Build the export zip from stored DB rows (getNewsBatchRuns output). */
async function buildNewsBatchZip(rows) {
  const results = [];
  for (const row of rows) {
    const rawItems = Array.isArray(row.results) ? row.results : null;
    const items = rawItems
      ? await backfillItemDescriptions(row.company_id, rawItems)
      : null;
    results.push({
      companyId: row.company_id,
      company_name: row.company_name,
      ticker: row.ticker,
      model: row.model,
      ok: row.ok,
      itemCount: row.item_count,
      durationMs: row.duration_ms,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      items,
      error: row.error_message,
    });
  }

  const entries = [];
  results.forEach((r, i) => {
    const folder = `${String(i + 1).padStart(2, '0')}_${slugify(r.company_name)}_${r.companyId}`;
    const meta = {
      companyId: r.companyId, company_name: r.company_name, ticker: r.ticker,
      model: r.model, ok: r.ok !== false, itemCount: r.itemCount,
      durationMs: r.durationMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
    };
    entries.push({ name: `${folder}/meta.json`, data: JSON.stringify(meta, null, 2) });
    if (r.ok !== false && Array.isArray(r.items)) {
      entries.push({
        name: `${folder}/source_releases.json`,
        data: JSON.stringify(sourceReleasesJson(r.items), null, 2),
      });
      entries.push({ name: `${folder}/source_releases.txt`, data: sourcesToTxt(r.items) });
      entries.push({ name: `${folder}/comparison.csv`, data: comparisonCsv(r.items) });
      entries.push({ name: `${folder}/enriched.json`, data: JSON.stringify(r.items, null, 2) });
      entries.push({ name: `${folder}/enriched.csv`, data: itemsToCsv(r.items) });
    } else {
      entries.push({ name: `${folder}/error.txt`, data: String(r.error || 'Analysis failed') });
    }
  });
  entries.push({ name: 'summary.csv', data: summaryCsv(results) });
  return buildZip(entries);
}

module.exports = {
  DEFAULT_COMPANY_SAMPLE,
  ITEMS_PER_COMPANY,
  getDefaultPrompt,
  getActivePrompt,
  getProductionPrompt,
  getDraftPrompt,
  isPromptCustom,
  saveTestingPrompt,
  saveDraftPrompt,
  saveProductionPrompt,
  buildNewsPromptPayload,
  pickUntestedCompanies,
  getCompanyById,
  getCompanyNewsItems,
  fetchCompanyReleasesRealtime,
  newsTestedStats,
  resetNewsTestRuns,
  recordNewsTestRun,
  getNewsBatchRuns,
  analyzeCompanyNews,
  buildNewsBatchZip,
  itemsToCsv,
};
