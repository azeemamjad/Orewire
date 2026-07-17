/**
 * Filing testing harness (Admin → Testing → Filings).
 *
 * Lets an operator run the filing-analysis LLM against a random sample of
 * never-before-tested filings, with a custom prompt and model, then export the
 * per-filing JSON + CSV results as a zip. Tested filings are remembered in
 * filing_test_runs so the picker only ever surfaces new documents.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const db = require('../../db');
const { chatWithSystem } = require('../ai/client');
const { extractTextWithFallback } = require('../scraper/analyzer');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../scraper/analyzer/prompt');
const { validateAnalysis } = require('../scraper/analyzer/validate');
const { MIN_EXTRACT_CHARS, extractionFailedAnalysis } = require('../scraper/analyzer/constants');
const {
  isRemoteStoragePath,
  parseStoragePath,
  getObjectStream,
} = require('../infra/object-storage');
const { DOWNLOADS_DIR } = require('../scraper/paths');
const { buildZip } = require('./zip');

const DEFAULT_SAMPLE_SIZE = 19;

function getDefaultPrompt() {
  return SYSTEM_PROMPT;
}

// ── Editable prompt (persisted in app_settings) ─────────────────────────────

const PROMPT_KEY = 'testing_filing_prompt';

/** The prompt the operator is currently working with: saved custom, else default. */
async function getActivePrompt() {
  try {
    const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [PROMPT_KEY]);
    const v = r.rows[0]?.value;
    if (v && typeof v.prompt === 'string' && v.prompt.trim()) return v.prompt;
  } catch { /* fall through to default */ }
  return SYSTEM_PROMPT;
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
  const text = String(prompt ?? '');
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PROMPT_KEY, JSON.stringify({ prompt: text })],
  );
  return text;
}

// ── Selection & tracking ────────────────────────────────────────────────────

/** Random filings that have a PDF and have never been part of a test run. */
async function pickUntestedFilings(limit = DEFAULT_SAMPLE_SIZE, filingType = null) {
  const n = Math.max(1, Math.min(100, parseInt(limit, 10) || DEFAULT_SAMPLE_SIZE));
  const params = [n];
  let typeClause = '';
  if (filingType) {
    params.push(filingType);
    typeClause = ` AND f.filing_type = $${params.length}`;
  }
  const r = await db.query(
    `SELECT f.id, f.company_name, f.exchange, f.filing_type, f.commodity,
            f.pdf_filename, f.pdf_path, c.ticker
       FROM filings f
       LEFT JOIN companies c ON c.id = f.company_id
      WHERE f.pdf_path IS NOT NULL
        AND f.id NOT IN (SELECT DISTINCT filing_id FROM filing_test_runs)${typeClause}
      ORDER BY random()
      LIMIT $1`,
    params,
  );
  return r.rows;
}

/**
 * Untested filing counts grouped by filing type (plus a grand total), so the
 * picker can show operators how many documents remain per category at a glance.
 */
async function untestedCountsByType() {
  const r = await db.query(
    `SELECT COALESCE(f.filing_type, 'Other') AS filing_type, COUNT(*)::int AS n
       FROM filings f
      WHERE f.pdf_path IS NOT NULL
        AND f.id NOT IN (SELECT DISTINCT filing_id FROM filing_test_runs)
      GROUP BY COALESCE(f.filing_type, 'Other')`,
  );
  const byType = {};
  let total = 0;
  for (const row of r.rows) {
    byType[row.filing_type] = row.n;
    total += row.n;
  }
  return { total, byType };
}

/**
 * Clear tested history so the picker surfaces filings again ("start from the
 * start"). Scoped to a single filing type when provided, otherwise wipes all
 * recorded test runs. Returns the number of run rows removed.
 */
async function resetTestRuns(filingType = null) {
  if (filingType) {
    const r = await db.query(
      `DELETE FROM filing_test_runs
        WHERE filing_id IN (SELECT id FROM filings WHERE filing_type = $1)`,
      [filingType],
    );
    return r.rowCount || 0;
  }
  const r = await db.query(`DELETE FROM filing_test_runs`);
  return r.rowCount || 0;
}

/** Aggregate AI cost/cache accounting per feature over the retention window. */
async function costSummary({ days = 3 } = {}) {
  const r = await db.query(
    `SELECT feature,
            COUNT(*)::int                              AS calls,
            COALESCE(SUM(prompt_tokens), 0)::bigint    AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
            COALESCE(SUM(cache_hit_tokens), 0)::bigint  AS cache_hit_tokens,
            COALESCE(SUM(cache_miss_tokens), 0)::bigint AS cache_miss_tokens,
            COALESCE(AVG(prompt_tokens), 0)::numeric    AS avg_prompt,
            COALESCE(AVG(completion_tokens), 0)::numeric AS avg_completion
       FROM ai_usage_events
      WHERE status = 'success'
        AND started_at >= NOW() - make_interval(days => $1::int)
      GROUP BY feature
      ORDER BY calls DESC`,
    [Math.max(1, parseInt(days, 10) || 3)],
  );
  return r.rows.map((row) => {
    const hit = Number(row.cache_hit_tokens) || 0;
    const miss = Number(row.cache_miss_tokens) || 0;
    return {
      feature: row.feature,
      calls: row.calls,
      promptTokens: Number(row.prompt_tokens) || 0,
      completionTokens: Number(row.completion_tokens) || 0,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      avgPrompt: Math.round(Number(row.avg_prompt) || 0),
      avgCompletion: Math.round(Number(row.avg_completion) || 0),
      cacheHitRate: (hit + miss) ? +(hit / (hit + miss)).toFixed(3) : null,
    };
  });
}

async function getFilingById(id) {
  const r = await db.query(
    `SELECT f.id, f.company_name, f.exchange, f.filing_type, f.commodity,
            f.pdf_filename, f.pdf_path, c.ticker
       FROM filings f
       LEFT JOIN companies c ON c.id = f.company_id
      WHERE f.id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

async function testedStats() {
  const [tested, runs, total] = await Promise.all([
    db.query(`SELECT COUNT(DISTINCT filing_id)::int AS n FROM filing_test_runs`),
    db.query(`SELECT COUNT(*)::int AS n FROM filing_test_runs`),
    db.query(`SELECT COUNT(*)::int AS n FROM filings WHERE pdf_path IS NOT NULL`),
  ]);
  const testedFilings = tested.rows[0]?.n || 0;
  const totalFilings = total.rows[0]?.n || 0;
  return {
    testedFilings,
    totalRuns: runs.rows[0]?.n || 0,
    totalFilings,
    untested: Math.max(0, totalFilings - testedFilings),
  };
}

async function recordTestRun(filingId, {
  batchId, companyName, exchange, filingType, model, verdict, ok,
  durationMs, promptTokens, completionTokens, analysis, rawResponse, errorMessage,
} = {}) {
  await db.query(
    `INSERT INTO filing_test_runs
       (batch_id, filing_id, company_name, exchange, filing_type, model, verdict, ok,
        duration_ms, prompt_tokens, completion_tokens, analysis, raw_response, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
    [
      batchId || null,
      filingId,
      companyName || null,
      exchange || null,
      filingType || null,
      model || null,
      verdict || null,
      ok !== false,
      Number.isFinite(durationMs) ? durationMs : null,
      Number.isFinite(promptTokens) ? promptTokens : null,
      Number.isFinite(completionTokens) ? completionTokens : null,
      analysis ? JSON.stringify(analysis) : null,
      rawResponse || null,
      errorMessage || null,
    ],
  );
}

/** All stored runs for a batch, in the order they were tested. */
async function getBatchRuns(batchId) {
  const r = await db.query(
    `SELECT filing_id, company_name, exchange, filing_type, model, verdict, ok,
            duration_ms, prompt_tokens, completion_tokens, analysis, raw_response, error_message
       FROM filing_test_runs
      WHERE batch_id = $1
      ORDER BY id ASC`,
    [batchId],
  );
  return r.rows;
}

// ── PDF loading (S3 or local) ───────────────────────────────────────────────

async function loadPdfToTempPath(filing) {
  const pdfPath = filing.pdf_path;
  if (!pdfPath) throw new Error('Filing has no PDF path');

  if (isRemoteStoragePath(pdfPath)) {
    const key = parseStoragePath(pdfPath);
    if (!key) throw new Error('Could not resolve object-storage key from pdf_path');
    const stream = await getObjectStream(key);
    const tmp = path.join(os.tmpdir(), `orewire-test-${filing.id}-${process.pid}-${key.split('/').pop()}`);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      stream.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      stream.pipe(ws);
    });
    return { pdfPath: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } };
  }

  const resolved = path.resolve(pdfPath);
  if (resolved !== DOWNLOADS_DIR && !resolved.startsWith(DOWNLOADS_DIR + path.sep)) {
    throw new Error('PDF path is outside the downloads directory');
  }
  if (!fs.existsSync(resolved)) throw new Error('PDF file not found on disk');
  return { pdfPath: resolved, cleanup: () => {} };
}

// ── Analysis ────────────────────────────────────────────────────────────────

function parseJson(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Analyze one filing with a custom system prompt + model. Bypasses the global
 * AI pause (this is an explicit manual action). Never throws for expected
 * failures — returns { ok:false, error } instead so the batch keeps going.
 */
async function analyzeFilingForTest({ filing, prompt, model, timeoutMs = 180000 }) {
  const started = Date.now();
  let cleanup = () => {};
  try {
    const loaded = await loadPdfToTempPath(filing);
    cleanup = loaded.cleanup;

    const { text } = await extractTextWithFallback(loaded.pdfPath);
    const textLength = text.trim().length;

    if (textLength < MIN_EXTRACT_CHARS) {
      const analysis = extractionFailedAnalysis(
        'PDF has no extractable text layer (image-only or corrupt).',
      );
      return {
        ok: true,
        analysis,
        verdict: analysis.verdict,
        model: model || null,
        durationMs: Date.now() - started,
        promptTokens: 0,
        completionTokens: 0,
        extractionFailed: true,
      };
    }

    const meta = {
      filing_type: filing.filing_type || 'Unknown',
      exchange: filing.exchange || 'SEDAR+ (Canada)',
      company_name: filing.company_name || 'Unknown',
      ticker: filing.ticker || 'N/A',
      commodity: filing.commodity || 'N/A',
    };
    const userPrompt = buildUserPrompt(meta, text);

    const resp = await chatWithSystem({
      feature: 'filing_testing',
      system: prompt && String(prompt).trim() ? String(prompt) : SYSTEM_PROMPT,
      user: userPrompt,
      model: model || undefined,
      timeoutMs,
      bypassPause: true,
    });

    let analysis;
    try {
      analysis = parseJson(resp.content);
    } catch {
      return {
        ok: false,
        error: 'Model returned invalid JSON',
        raw: (resp.content || '').slice(0, 4000),
        model: resp.model,
        durationMs: Date.now() - started,
        promptTokens: resp.promptTokens,
        completionTokens: resp.completionTokens,
      };
    }

    const validated = validateAnalysis(analysis, { textLength });
    return {
      ok: true,
      analysis: validated,
      verdict: validated.verdict,
      model: resp.model,
      durationMs: Date.now() - started,
      promptTokens: resp.promptTokens,
      completionTokens: resp.completionTokens,
      usedOcr: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      model: model || null,
      durationMs: Date.now() - started,
    };
  } finally {
    cleanup();
  }
}

// ── CSV / zip export ─────────────────────────────────────────────────────────

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Flatten a nested analysis object into dot/bracket-keyed leaf values. */
function flatten(value, prefix, out) {
  if (value === null || value === undefined) {
    out[prefix] = '';
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      out[prefix] = '[]';
    } else {
      value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    }
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out[prefix] = '{}';
    } else {
      keys.forEach((k) => flatten(value[k], prefix ? `${prefix}.${k}` : k, out));
    }
  } else {
    out[prefix] = value;
  }
}

function analysisToCsv(analysis) {
  const flat = {};
  flatten(analysis, '', flat);
  const lines = ['field,value'];
  for (const [k, v] of Object.entries(flat)) {
    lines.push(`${csvCell(k)},${csvCell(v)}`);
  }
  return lines.join('\r\n');
}

function slugify(s) {
  return String(s || 'filing')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'filing';
}

function summaryCsv(results) {
  const lines = ['index,filing_id,company_name,exchange,filing_type,model,ok,verdict,duration_ms,prompt_tokens,completion_tokens,error'];
  results.forEach((r, i) => {
    lines.push([
      i + 1, r.filingId, r.company_name, r.exchange, r.filing_type, r.model,
      r.ok !== false, r.verdict || '', r.durationMs || '',
      r.promptTokens ?? '', r.completionTokens ?? '', r.ok === false ? (r.error || '') : '',
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}

/**
 * Build a zip: one folder per filing (JSON + CSV), plus a top-level summary.csv.
 * @param {Array<object>} results — analyze-one result objects sent back by the client
 */
function buildResultsZip(results) {
  const entries = [];
  results.forEach((r, i) => {
    const folder = `${String(i + 1).padStart(2, '0')}_${slugify(r.company_name)}_${r.filingId}`;
    const meta = {
      filingId: r.filingId,
      company_name: r.company_name,
      exchange: r.exchange,
      filing_type: r.filing_type,
      model: r.model,
      verdict: r.verdict,
      ok: r.ok !== false,
      durationMs: r.durationMs,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
    };
    entries.push({ name: `${folder}/meta.json`, data: JSON.stringify(meta, null, 2) });

    if (r.ok !== false && r.analysis) {
      entries.push({ name: `${folder}/analysis.json`, data: JSON.stringify(r.analysis, null, 2) });
      entries.push({ name: `${folder}/analysis.csv`, data: analysisToCsv(r.analysis) });
    } else {
      entries.push({ name: `${folder}/error.txt`, data: String(r.error || 'Analysis failed') });
      if (r.raw) entries.push({ name: `${folder}/raw_response.txt`, data: String(r.raw) });
    }

    // Include the original filing PDF alongside its result for easy comparison.
    if (r._pdf && r._pdf.buffer) {
      entries.push({ name: `${folder}/${r._pdf.filename}`, data: r._pdf.buffer });
    } else if (r._pdfError) {
      entries.push({ name: `${folder}/pdf_unavailable.txt`, data: `Original PDF could not be attached: ${r._pdfError}` });
    }
  });
  entries.push({ name: 'summary.csv', data: summaryCsv(results) });
  return buildZip(entries);
}

/** Read a filing's original PDF bytes (from S3 or local disk). */
async function getFilingPdfBuffer(filing) {
  const { pdfPath, cleanup } = await loadPdfToTempPath(filing);
  try {
    const buffer = fs.readFileSync(pdfPath);
    const raw = filing.pdf_filename || path.basename(pdfPath) || `filing-${filing.id}.pdf`;
    let filename = String(raw).replace(/[\\/]/g, '_').trim() || `filing-${filing.id}.pdf`;
    if (!/\.pdf$/i.test(filename)) filename += '.pdf';
    return { buffer, filename };
  } finally {
    cleanup();
  }
}

/** Build the export zip from stored DB rows, attaching each original PDF. */
async function buildBatchZip(rows) {
  const results = rows.map((row) => ({
    filingId: row.filing_id,
    company_name: row.company_name,
    exchange: row.exchange,
    filing_type: row.filing_type,
    model: row.model,
    verdict: row.verdict,
    ok: row.ok,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    analysis: row.analysis,
    error: row.error_message,
    raw: row.raw_response,
  }));

  // Fetch each filing's original PDF (best-effort — a missing file leaves a note).
  for (const r of results) {
    try {
      const filing = await getFilingById(r.filingId);
      if (filing && filing.pdf_path) {
        r._pdf = await getFilingPdfBuffer(filing);
      } else {
        r._pdfError = 'Filing has no stored PDF path';
      }
    } catch (err) {
      r._pdfError = err?.message || String(err);
    }
  }

  return buildResultsZip(results);
}

module.exports = {
  DEFAULT_SAMPLE_SIZE,
  getDefaultPrompt,
  getActivePrompt,
  isPromptCustom,
  saveTestingPrompt,
  pickUntestedFilings,
  untestedCountsByType,
  resetTestRuns,
  costSummary,
  getFilingById,
  testedStats,
  recordTestRun,
  getBatchRuns,
  analyzeFilingForTest,
  analysisToCsv,
  buildResultsZip,
  buildBatchZip,
  getFilingPdfBuffer,
};
