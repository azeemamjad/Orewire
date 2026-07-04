const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { DOWNLOADS_DIR } = require('../scraper/paths');
const { analyzePdf } = require('../scraper/analyzer');
const { upsertInsiderData } = require('../../db/insiders');
const {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  aiOutputParams,
  AI_OUTPUT_SQL,
} = require('../scraper/analyzer/persist');
const { isExtractionFailed } = require('../scraper/analyzer/constants');
const { isRemoteStoragePath } = require('../infra/object-storage');

function walkPdfs(dir, map = new Map()) {
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkPdfs(full, map);
    else if (name.toLowerCase().endsWith('.pdf') && !name.toLowerCase().endsWith('_analysis.pdf')) {
      const base = name.toLowerCase();
      if (!map.has(base)) map.set(base, full);
    }
  }
  return map;
}

function resolveLocalPdfPath(filing, diskByName) {
  const p = filing.pdf_path;
  if (p && !isRemoteStoragePath(p) && fs.existsSync(p)) {
    return path.resolve(p);
  }
  const fname = (filing.pdf_filename || path.basename(p || '')).toLowerCase();
  if (fname && diskByName.has(fname)) return diskByName.get(fname);
  return null;
}

/**
 * Pending (unanalyzed) filings that have a PDF on local disk.
 */
async function listPendingOnDisk({ limit = 500 } = {}) {
  const { rows } = await db.query(
    `SELECT id, company_id, company_name, pdf_path, pdf_filename, exchange, status
       FROM filings
      WHERE COALESCE(analyzed, 0) = 0
      ORDER BY id DESC
      LIMIT $1`,
    [Math.max(1, Math.min(5000, limit))],
  );

  const diskByName = walkPdfs(DOWNLOADS_DIR);
  const items = [];
  for (const row of rows) {
    const localPath = resolveLocalPdfPath(row, diskByName);
    if (!localPath) continue;
    items.push({
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      pdfFilename: row.pdf_filename,
      pdfPath: row.pdf_path,
      localPath,
      exchange: row.exchange,
      status: row.status,
    });
  }
  return {
    downloadsDir: DOWNLOADS_DIR,
    pendingInDb: rows.length,
    onDisk: items.length,
    items,
  };
}

async function persistAnalysis(filing, analysis) {
  const status = resolveFilingStatus(analysis, filing.companyName);
  const analyzed = analyzedFlagForAnalysis(analysis);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE filings SET analyzed = $2, status = $3 WHERE id = $1`,
      [filing.id, analyzed, status],
    );
    await client.query(AI_OUTPUT_SQL, aiOutputParams(filing.id, analysis));
    if (!isExtractionFailed(analysis)) {
      await upsertInsiderData(
        client,
        filing.companyId,
        filing.id,
        analysis.data_extracted || {},
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
  return { status, analyzed, verdict: analysis.verdict };
}

/**
 * Analyze pending filings that have PDFs on disk.
 * @param {{ limit?: number, onProgress?: function }} opts
 */
async function processPendingOnDisk({ limit = 50, onProgress } = {}) {
  const listed = await listPendingOnDisk({ limit: Math.max(limit, 500) });
  const queue = listed.items.slice(0, Math.max(1, Math.min(200, limit)));
  const stats = {
    total: queue.length,
    processed: 0,
    ok: 0,
    extractionFailed: 0,
    errors: 0,
    results: [],
  };

  const emit = (payload) => {
    if (typeof onProgress === 'function') onProgress({ ...stats, ...payload });
  };

  emit({ phase: 'start' });

  for (const filing of queue) {
    try {
      emit({
        phase: 'analyzing',
        currentId: filing.id,
        currentFile: filing.pdfFilename,
      });
      const analysis = await analyzePdf(filing.localPath, {
        company_name: filing.companyName,
        exchange: filing.exchange || 'Unknown',
      });
      const saved = await persistAnalysis(filing, analysis);
      stats.processed++;
      if (isExtractionFailed(analysis)) stats.extractionFailed++;
      else stats.ok++;
      stats.results.push({
        id: filing.id,
        companyName: filing.companyName,
        pdfFilename: filing.pdfFilename,
        verdict: saved.verdict,
        status: saved.status,
      });
    } catch (err) {
      stats.processed++;
      stats.errors++;
      stats.results.push({
        id: filing.id,
        companyName: filing.companyName,
        pdfFilename: filing.pdfFilename,
        error: err.message || String(err),
      });
    }
    emit({ phase: 'progress' });
  }

  emit({ phase: 'done' });
  return stats;
}

module.exports = {
  listPendingOnDisk,
  processPendingOnDisk,
  resolveLocalPdfPath,
  walkPdfs,
};
