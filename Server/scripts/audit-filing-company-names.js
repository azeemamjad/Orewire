#!/usr/bin/env node
/**
 * Sample filings and report when company_name does not appear in extracted PDF text.
 *
 *   node scripts/audit-filing-company-names.js
 *   node scripts/audit-filing-company-names.js --limit 50
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { extractTextWithFallback } = require('../lib/scraper/analyzer');
const {
  isRemoteStoragePath,
  parseStoragePath,
  getObjectStream,
  isStorageEnabled,
} = require('../lib/infra/object-storage');

function argLimit() {
  const i = process.argv.indexOf('--limit');
  if (i >= 0) return Math.max(10, Math.min(200, parseInt(process.argv[i + 1], 10) || 50));
  return 50;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|plc|co|company)\b/g, '')
    .trim();
}

async function downloadToTemp(filing) {
  const pdfPath = filing.pdf_path;
  if (!isRemoteStoragePath(pdfPath)) {
    if (fs.existsSync(pdfPath)) return { localPath: pdfPath, cleanup: false };
    return null;
  }
  if (!isStorageEnabled()) return null;
  const key = parseStoragePath(pdfPath);
  if (!key) return null;
  const tmp = path.join(os.tmpdir(), `orewire_audit_${filing.id}_${Date.now()}.pdf`);
  const stream = await getObjectStream(key);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    stream.pipe(out);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
  return { localPath: tmp, cleanup: true };
}

async function main() {
  const limit = argLimit();
  const { rows } = await db.query(
    `SELECT id, company_name, pdf_path, pdf_filename
       FROM filings
      WHERE pdf_path IS NOT NULL
      ORDER BY random()
      LIMIT $1`,
    [limit],
  );

  let checked = 0;
  let emptyText = 0;
  let mismatch = 0;
  let match = 0;
  let errors = 0;
  const samples = [];

  for (const filing of rows) {
    let local = null;
    try {
      local = await downloadToTemp(filing);
      if (!local) {
        errors++;
        continue;
      }
      const { text } = await extractTextWithFallback(local.localPath);
      checked++;
      if (text.trim().length < 80) {
        emptyText++;
        continue;
      }
      const company = norm(filing.company_name);
      const body = norm(text.slice(0, 50000));
      if (!company || !body.includes(company.split(' ')[0])) {
        // require at least first significant token of company name
        const tokens = company.split(' ').filter((t) => t.length > 3);
        const hit = tokens.some((t) => body.includes(t));
        if (!hit) {
          mismatch++;
          if (samples.length < 15) {
            samples.push({
              id: filing.id,
              company_name: filing.company_name,
              pdf_filename: filing.pdf_filename,
            });
          }
          continue;
        }
      }
      match++;
    } catch {
      errors++;
    } finally {
      if (local?.cleanup && local.localPath && fs.existsSync(local.localPath)) {
        try { fs.unlinkSync(local.localPath); } catch { /* ignore */ }
      }
    }
  }

  console.log(JSON.stringify({
    sampled: rows.length,
    checked,
    match,
    mismatch,
    emptyText,
    errors,
    mismatchRate: checked ? +(mismatch / checked).toFixed(3) : null,
    mismatchSamples: samples,
  }, null, 2));

  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
