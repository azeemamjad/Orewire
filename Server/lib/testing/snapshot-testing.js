/**
 * Company-snapshot testing harness (Admin → Testing → Snapshots).
 *
 * Same shape as the news harness: pick N random companies, regenerate each
 * company's AI snapshot with an editable prompt + model, show the prose + key
 * points, and export a zip. Reuses the production context builder / parser so
 * the test matches production exactly. Tested companies are remembered in
 * snapshot_test_runs so the picker only surfaces new ones.
 */
const db = require('../../db');
const { chatWithSystem } = require('../ai/client');
const {
  SNAPSHOT_SYSTEM,
  gatherSnapshotContext,
  buildSnapshotPrompt,
  parseSnapshotText,
} = require('../companies/snapshot');
const { buildZip } = require('./zip');

const DEFAULT_COMPANY_SAMPLE = 10;
const MAX_COMPANY_SAMPLE = 200;
const PROMPT_KEY = 'testing_snapshot_prompt';

function getDefaultPrompt() {
  return SNAPSHOT_SYSTEM;
}

// ── Editable prompt (persisted in app_settings) ─────────────────────────────

async function getActivePrompt() {
  try {
    const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [PROMPT_KEY]);
    const v = r.rows[0]?.value;
    if (v && typeof v.prompt === 'string' && v.prompt.trim()) return v.prompt;
  } catch { /* fall through */ }
  return SNAPSHOT_SYSTEM;
}

async function isPromptCustom() {
  try {
    const r = await db.query(`SELECT 1 FROM app_settings WHERE key = $1`, [PROMPT_KEY]);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function saveTestingPrompt(prompt) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PROMPT_KEY, JSON.stringify({ prompt: String(prompt ?? '') })],
  );
}

// ── Selection & tracking ────────────────────────────────────────────────────

/** Random companies (with a ticker, so there's market context) never tested. */
async function pickUntestedCompanies(limit = DEFAULT_COMPANY_SAMPLE) {
  const n = Math.max(1, Math.min(MAX_COMPANY_SAMPLE, parseInt(limit, 10) || DEFAULT_COMPANY_SAMPLE));
  const r = await db.query(
    `SELECT id, name, ticker, exchange
       FROM companies
      WHERE ticker IS NOT NULL AND ticker <> ''
        AND id NOT IN (SELECT DISTINCT company_id FROM snapshot_test_runs WHERE company_id IS NOT NULL)
      ORDER BY random()
      LIMIT $1`,
    [n],
  );
  return r.rows;
}

async function getCompanyById(id) {
  const r = await db.query(`SELECT id, name, ticker, exchange FROM companies WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function snapshotTestedStats() {
  const [tested, runs, total] = await Promise.all([
    db.query(`SELECT COUNT(DISTINCT company_id)::int AS n FROM snapshot_test_runs WHERE company_id IS NOT NULL`),
    db.query(`SELECT COUNT(*)::int AS n FROM snapshot_test_runs`),
    db.query(`SELECT COUNT(*)::int AS n FROM companies WHERE ticker IS NOT NULL AND ticker <> ''`),
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

async function recordSnapshotTestRun(companyId, {
  batchId, companyName, ticker, model, ok,
  durationMs, promptTokens, completionTokens, result, errorMessage,
} = {}) {
  await db.query(
    `INSERT INTO snapshot_test_runs
       (batch_id, company_id, company_name, ticker, model, ok,
        duration_ms, prompt_tokens, completion_tokens, result, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      batchId || null,
      companyId,
      companyName || null,
      ticker || null,
      model || null,
      ok !== false,
      Number.isFinite(durationMs) ? durationMs : null,
      Number.isFinite(promptTokens) ? promptTokens : null,
      Number.isFinite(completionTokens) ? completionTokens : null,
      result ? JSON.stringify(result) : null,
      errorMessage || null,
    ],
  );
}

async function getSnapshotBatchRuns(batchId) {
  const r = await db.query(
    `SELECT company_id, company_name, ticker, model, ok,
            duration_ms, prompt_tokens, completion_tokens, result, error_message
       FROM snapshot_test_runs
      WHERE batch_id = $1
      ORDER BY id ASC`,
    [batchId],
  );
  return r.rows;
}

// ── Analysis ────────────────────────────────────────────────────────────────

/**
 * Regenerate one company's snapshot with the (editable) prompt. Reuses the
 * production context builder + parser. Never throws for expected failures.
 */
async function analyzeCompanySnapshot({ company, prompt, model, timeoutMs = 120000 }) {
  const started = Date.now();
  let ctx;
  try {
    ctx = await gatherSnapshotContext(company.id);
  } catch (err) {
    return { ok: false, error: `Failed to gather context: ${err.message}`, durationMs: Date.now() - started };
  }
  if (!ctx) {
    return { ok: false, error: 'No snapshot context (company not found or no data)', durationMs: Date.now() - started };
  }

  const userPrompt = buildSnapshotPrompt(ctx);
  let resp;
  try {
    resp = await chatWithSystem({
      feature: 'company_snapshot_test',
      system: prompt && String(prompt).trim() ? String(prompt) : SNAPSHOT_SYSTEM,
      user: userPrompt,
      model: model || undefined,
      timeoutMs,
      bypassPause: true,
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err), durationMs: Date.now() - started };
  }

  const parsed = parseSnapshotText(resp.content);
  if (!parsed.paragraphs.length) {
    return {
      ok: false,
      error: 'Empty snapshot from model',
      raw: (resp.content || '').slice(0, 4000),
      model: resp.model,
      durationMs: Date.now() - started,
      promptTokens: resp.promptTokens,
      completionTokens: resp.completionTokens,
    };
  }

  return {
    ok: true,
    body: parsed.body,
    paragraphs: parsed.paragraphs,
    keyPoints: parsed.keyPoints,
    model: resp.model,
    durationMs: Date.now() - started,
    promptTokens: resp.promptTokens,
    completionTokens: resp.completionTokens,
  };
}

// ── zip export ────────────────────────────────────────────────────────────────

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function slugify(s) {
  return String(s || 'company').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'company';
}

function summaryCsv(results) {
  const lines = ['index,company_id,company,ticker,model,ok,paragraphs,duration_ms,prompt_tokens,completion_tokens,error'];
  results.forEach((r, i) => {
    const paras = r.result && Array.isArray(r.result.paragraphs) ? r.result.paragraphs.length : 0;
    lines.push([
      i + 1, r.companyId, r.company_name, r.ticker, r.model, r.ok !== false, paras,
      r.durationMs || '', r.promptTokens ?? '', r.completionTokens ?? '', r.ok === false ? (r.error || '') : '',
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

/** Build the export zip from stored DB rows (getSnapshotBatchRuns output). */
function buildSnapshotBatchZip(rows) {
  const results = rows.map((row) => ({
    companyId: row.company_id,
    company_name: row.company_name,
    ticker: row.ticker,
    model: row.model,
    ok: row.ok,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    result: row.result,
    error: row.error_message,
  }));

  const entries = [];
  results.forEach((r, i) => {
    const folder = `${String(i + 1).padStart(2, '0')}_${slugify(r.company_name)}_${r.companyId}`;
    const meta = {
      companyId: r.companyId, company_name: r.company_name, ticker: r.ticker,
      model: r.model, ok: r.ok !== false,
      durationMs: r.durationMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
    };
    entries.push({ name: `${folder}/meta.json`, data: JSON.stringify(meta, null, 2) });
    if (r.ok !== false && r.result) {
      entries.push({ name: `${folder}/snapshot.json`, data: JSON.stringify(r.result, null, 2) });
      const txt = (r.result.paragraphs || []).join('\n\n')
        + (r.result.keyPoints && r.result.keyPoints.length ? `\n\nKey points\n${r.result.keyPoints.map((k) => `- ${k}`).join('\n')}` : '');
      entries.push({ name: `${folder}/snapshot.txt`, data: txt });
    } else {
      entries.push({ name: `${folder}/error.txt`, data: String(r.error || 'Analysis failed') });
    }
  });
  entries.push({ name: 'summary.csv', data: summaryCsv(results) });
  return buildZip(entries);
}

module.exports = {
  DEFAULT_COMPANY_SAMPLE,
  getDefaultPrompt,
  getActivePrompt,
  isPromptCustom,
  saveTestingPrompt,
  pickUntestedCompanies,
  getCompanyById,
  snapshotTestedStats,
  recordSnapshotTestRun,
  getSnapshotBatchRuns,
  analyzeCompanySnapshot,
  buildSnapshotBatchZip,
};
