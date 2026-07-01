#!/usr/bin/env node
/**
 * Compare local downloads, DB filings, and MinIO bucket usage.
 *   node scripts/audit-filing-storage.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  isMinioEnabled,
  getClient,
  getBucket,
  parseMinioPath,
  isMinioPath,
} = require('../lib/infra/object-storage');

const DOWNLOADS_DIR = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../Scraper/downloads'),
);

function walkFiles(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, ext, out);
    else if (!ext || name.toLowerCase().endsWith(ext)) out.push({ full, size: st.size });
  }
  return out;
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

async function listAllMinioObjects() {
  const minio = getClient();
  const bucket = getBucket();
  const objects = [];
  const stream = minio.listObjectsV2(bucket, '', true);
  await new Promise((resolve, reject) => {
    stream.on('data', (obj) => objects.push(obj));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return objects;
}

async function main() {
  console.log('=== Filing storage audit ===\n');
  console.log('DOWNLOADS_DIR:', DOWNLOADS_DIR);
  console.log('Exists:', fs.existsSync(DOWNLOADS_DIR));

  const pdfs = walkFiles(DOWNLOADS_DIR, '.pdf');
  const jsons = walkFiles(DOWNLOADS_DIR, '.json');
  const pdfBytes = pdfs.reduce((s, f) => s + f.size, 0);
  const jsonBytes = jsons.reduce((s, f) => s + f.size, 0);

  console.log('\n--- Local disk ---');
  console.log(`  PDF files:   ${pdfs.length}  (${fmtBytes(pdfBytes)})`);
  console.log(`  JSON files:  ${jsons.length}  (${fmtBytes(jsonBytes)})`);
  console.log(`  Total PDF+JSON: ${fmtBytes(pdfBytes + jsonBytes)}`);

  const { rows } = await db.query(`
    SELECT id, pdf_path, pdf_filename
    FROM filings
    WHERE pdf_path IS NOT NULL
    ORDER BY id
  `);

  let minioRows = 0;
  let localRows = 0;
  let localBytesInDb = 0;
  let localMissing = 0;
  const localPaths = new Set();

  for (const row of rows) {
    if (isMinioPath(row.pdf_path)) {
      minioRows++;
      continue;
    }
    localRows++;
    const resolved = path.resolve(row.pdf_path);
    localPaths.add(resolved);
    if (fs.existsSync(resolved)) {
      localBytesInDb += fs.statSync(resolved).size;
    } else {
      localMissing++;
    }
  }

  console.log('\n--- Database (filings) ---');
  console.log(`  Total rows with pdf_path: ${rows.length}`);
  console.log(`  minio: paths:            ${minioRows}`);
  console.log(`  Local paths (pending):    ${localRows}`);
  console.log(`  Local size (DB refs):     ${fmtBytes(localBytesInDb)}`);
  console.log(`  Local paths missing:      ${localMissing}`);

  const pdfPathSet = new Set(pdfs.map((f) => f.full));
  let orphans = 0;
  let orphanBytes = 0;
  for (const f of pdfs) {
    if (!localPaths.has(f.full)) {
      const rel = path.relative(DOWNLOADS_DIR, f.full);
      const inDbAsMinio = minioRows > 0; // rough — orphans are disk PDFs not referenced as local path
      orphans++;
      orphanBytes += f.size;
    }
  }
  // Better orphan check: PDF on disk not matching any DB local path and not clearly migrated
  orphans = 0;
  orphanBytes = 0;
  const dbLocalResolved = new Set(
    rows.filter((r) => !isMinioPath(r.pdf_path)).map((r) => path.resolve(r.pdf_path)),
  );
  for (const f of pdfs) {
    if (!dbLocalResolved.has(f.full)) {
      orphans++;
      orphanBytes += f.size;
    }
  }

  console.log('\n--- Orphans (PDF on disk, not a pending local DB path) ---');
  console.log(`  Count: ${orphans}  (${fmtBytes(orphanBytes)})`);
  console.log('  (Includes already-migrated filings still on disk if --delete-local not run)');

  if (isMinioEnabled()) {
    try {
      const objects = await listAllMinioObjects();
      const objBytes = objects.reduce((s, o) => s + (o.size || 0), 0);
      const pdfObjs = objects.filter((o) => o.name.toLowerCase().endsWith('.pdf'));

      console.log('\n--- MinIO bucket ---');
      console.log(`  Bucket: ${getBucket()}`);
      console.log(`  Objects (all):  ${objects.length}  (${fmtBytes(objBytes)})`);
      console.log(`  Objects (.pdf): ${pdfObjs.length}`);

      if (minioRows > 0 && objects.length !== minioRows) {
        console.log(`  Note: ${minioRows} DB rows use minio: but bucket has ${objects.length} objects`);
      }

      // Sample size mismatch: DB minio rows vs local file if still on disk
      let sizeMismatches = 0;
      let checked = 0;
      for (const row of rows) {
        if (!isMinioPath(row.pdf_path) || checked >= 50) continue;
        const key = parseMinioPath(row.pdf_path);
        const obj = objects.find((o) => o.name === key);
        const localGuess = path.join(DOWNLOADS_DIR, key);
        if (obj && fs.existsSync(localGuess)) {
          const localSize = fs.statSync(localGuess).size;
          if (Math.abs(localSize - obj.size) > 1024) sizeMismatches++;
          checked++;
        }
      }
      if (checked > 0) {
        console.log(`  Size mismatches (sample ${checked}): ${sizeMismatches}`);
      }
    } catch (err) {
      console.error('\n--- MinIO bucket ---');
      console.error('  Could not list bucket:', err.message);
    }
  } else {
    console.log('\n--- MinIO ---');
    console.log('  MINIO_ENABLED not set — skipping bucket listing');
  }

  console.log('\n--- Likely explanation ---');
  if (localRows > 0) {
    console.log(`  • ${localRows} filings still have local pdf_path — migration not finished.`);
  }
  if (orphanBytes > 1e9) {
    console.log(`  • ~${fmtBytes(orphanBytes)} on disk may be PDFs not linked in DB, or local copies after MinIO upload.`);
  }
  console.log('  • MinIO console "objects" counts every object; size is sum of stored bytes.');
  console.log('  • 25 GB local + 3.5 GB bucket often means: migration partial, or most disk is duplicates/orphans still local.');

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
