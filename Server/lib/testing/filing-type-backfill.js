/**
 * In-process filing_type backfill job for the Admin → Testing page.
 *
 * Classifies untyped filings (filing_type IS NULL) from their PDF and writes the
 * canonical type back, so the per-type counts/selection light up. Runs in the
 * background inside the API process; the UI starts it with a button and polls
 * getStatus() for live progress. Only one job runs at a time.
 *
 * Resumable & non-destructive: it only ever sets filing_type on rows that had
 * none, so re-running continues where it left off.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const pdfParse = require('pdf-parse');

const db = require('../../db');
const { classifyHeuristic, classifyFilingType, CANONICAL_SET } = require('../scraper/analyzer/classify');
const {
  isRemoteStoragePath,
  parseStoragePath,
  getObjectStream,
  isStorageEnabled,
} = require('../infra/object-storage');

const state = {
  status: 'idle', // 'idle' | 'running' | 'done' | 'stopped' | 'error'
  total: 0,
  processed: 0,
  typed: 0,
  skipped: 0,
  errors: 0,
  useAi: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  stopRequested: false,
};

function getStatus() {
  const elapsedMs = state.startedAt ? ((state.finishedAt || Date.now()) - state.startedAt) : 0;
  const rate = elapsedMs > 0 ? state.processed / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, state.total - state.processed);
  const etaSec = rate > 0 && state.status === 'running' ? Math.round(remaining / rate) : null;
  return {
    status: state.status,
    running: state.status === 'running',
    total: state.total,
    processed: state.processed,
    typed: state.typed,
    skipped: state.skipped,
    errors: state.errors,
    useAi: state.useAi,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    lastError: state.lastError,
    elapsedMs,
    rate: +rate.toFixed(2),
    remaining,
    etaSec,
  };
}

async function downloadToTemp(filing) {
  const pdfPath = filing.pdf_path;
  if (!isRemoteStoragePath(pdfPath)) {
    if (pdfPath && fs.existsSync(pdfPath)) return { localPath: pdfPath, cleanup: false };
    return null;
  }
  if (!isStorageEnabled()) return null;
  const key = parseStoragePath(pdfPath);
  if (!key) return null;
  const tmp = path.join(os.tmpdir(), `orewire_backfill_${filing.id}_${Date.now()}.pdf`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stream = await getObjectStream(key);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        stream.pipe(out);
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
      });
      return { localPath: tmp, cleanup: true };
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

async function classifyOne(filing) {
  let local = null;
  try {
    local = await downloadToTemp(filing);
    if (!local) return { filing_type: null };
    let text = '';
    try {
      const buf = fs.readFileSync(local.localPath);
      const data = await pdfParse(buf, { max: 2 });
      text = data.text || '';
    } catch {
      text = '';
    }
    if (text.trim().length < 40) return { filing_type: null };

    const meta = { pdf_filename: filing.pdf_filename, company_name: filing.company_name, exchange: filing.exchange };
    if (state.useAi) return await classifyFilingType({ text, meta });
    const h = classifyHeuristic({ filename: filing.pdf_filename, text });
    return { filing_type: h.type };
  } finally {
    if (local?.cleanup && local.localPath && fs.existsSync(local.localPath)) {
      try { fs.unlinkSync(local.localPath); } catch { /* ignore */ }
    }
  }
}

async function runLoop() {
  try {
    state.total = (await db.query(
      `SELECT COUNT(*)::int AS n FROM filings WHERE pdf_path IS NOT NULL AND filing_type IS NULL`,
    )).rows[0].n;
    if (!state.total) { state.status = 'done'; return; }

    let lastUntypedId = 0;
    const BATCH = 200;
    for (;;) {
      if (state.stopRequested) { state.status = 'stopped'; break; }
      const { rows } = await db.query(
        `SELECT id, company_name, exchange, pdf_filename, pdf_path
           FROM filings
          WHERE pdf_path IS NOT NULL AND filing_type IS NULL AND id > $1
          ORDER BY id ASC
          LIMIT $2`,
        [lastUntypedId, BATCH],
      );
      if (rows.length === 0) { state.status = 'done'; break; }

      for (const filing of rows) {
        if (state.stopRequested) { state.status = 'stopped'; break; }
        try {
          const res = await classifyOne(filing);
          state.processed += 1;
          if (res.filing_type && CANONICAL_SET.has(res.filing_type)) {
            await db.query(`UPDATE filings SET filing_type = $2 WHERE id = $1`, [filing.id, res.filing_type]);
            state.typed += 1;
          } else {
            state.skipped += 1;
            lastUntypedId = filing.id;
          }
        } catch (err) {
          state.processed += 1;
          state.errors += 1;
          state.lastError = err?.message || String(err);
          lastUntypedId = filing.id;
        }
      }
    }
  } catch (err) {
    state.status = 'error';
    state.lastError = err?.message || String(err);
  } finally {
    state.finishedAt = Date.now();
    state.stopRequested = false;
  }
}

/** Start a backfill run. No-op (returns started:false) if one is already running. */
function startBackfill({ useAi = false } = {}) {
  if (state.status === 'running') return { started: false, reason: 'already_running', status: getStatus() };
  state.status = 'running';
  state.total = 0;
  state.processed = 0;
  state.typed = 0;
  state.skipped = 0;
  state.errors = 0;
  state.useAi = !!useAi;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.lastError = null;
  state.stopRequested = false;
  // Fire and forget — progress is tracked in `state`, polled via getStatus().
  runLoop();
  return { started: true, status: getStatus() };
}

/** Request a graceful stop. The loop finishes the current filing then exits. */
function stopBackfill() {
  if (state.status === 'running') {
    state.stopRequested = true;
    return { stopping: true, status: getStatus() };
  }
  return { stopping: false, status: getStatus() };
}

module.exports = { startBackfill, stopBackfill, getStatus };
