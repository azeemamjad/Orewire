#!/usr/bin/env node
/**
 * Delete all files under DOWNLOADS_DIR after verifying every DB filing exists in MinIO.
 *
 *   node scripts/wipe-local-downloads.js --dry-run
 *   node scripts/wipe-local-downloads.js --confirm
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  isMinioEnabled,
  isMinioPath,
  parseMinioPath,
  objectExists,
} = require('../lib/infra/object-storage');

const { DOWNLOADS_DIR } = require('../lib/scraper/paths');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  return `${n} B`;
}

function walkAllFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkAllFiles(full, out);
    else out.push({ full, size: st.size });
  }
  return out;
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) removeEmptyDirs(full);
  }
  if (dir !== DOWNLOADS_DIR && fs.readdirSync(dir).length === 0) {
    if (!DRY_RUN) fs.rmdirSync(dir);
  }
}

async function verifyMinioFilings(rows) {
  const minioRows = rows.filter((r) => isMinioPath(r.pdf_path));
  let missing = 0;
  const missingSamples = [];

  for (let i = 0; i < minioRows.length; i++) {
    const row = minioRows[i];
    const key = parseMinioPath(row.pdf_path);
    if (!(await objectExists(key))) {
      missing++;
      if (missingSamples.length < 10) {
        missingSamples.push({ id: row.id, key });
      }
    }
    if ((i + 1) % 2000 === 0) {
      console.log(`[wipe] verified ${i + 1}/${minioRows.length} MinIO object(s)…`);
    }
  }

  return { minioRows: minioRows.length, missing, missingSamples };
}

async function main() {
  if (!DRY_RUN && !CONFIRM) {
    console.error('Pass --dry-run to preview or --confirm to delete (irreversible).');
    process.exit(1);
  }
  if (!isMinioEnabled()) {
    console.error('MINIO_ENABLED=true required before wiping local copies.');
    process.exit(1);
  }
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.log(`[wipe] DOWNLOADS_DIR does not exist: ${DOWNLOADS_DIR}`);
    await db.end();
    return;
  }

  const files = walkAllFiles(DOWNLOADS_DIR);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  console.log(`[wipe] DOWNLOADS_DIR: ${DOWNLOADS_DIR}`);
  console.log(`[wipe] local files: ${files.length} (${fmtBytes(totalBytes)})`);
  console.log(`[wipe] mode: ${DRY_RUN ? 'DRY RUN' : 'DELETE'}`);

  const { rows } = await db.query(
    `SELECT id, pdf_path FROM filings WHERE pdf_path IS NOT NULL ORDER BY id`,
  );
  const localDbRows = rows.filter((r) => !isMinioPath(r.pdf_path));
  if (localDbRows.length > 0) {
    console.error(`[wipe] ${localDbRows.length} filing(s) still use local pdf_path — migrate to MinIO first.`);
    process.exit(1);
  }

  console.log(`[wipe] verifying ${rows.length} MinIO-backed filing(s)…`);
  const check = await verifyMinioFilings(rows);
  if (check.missing > 0) {
    console.error(`[wipe] ${check.missing} DB filing(s) missing from MinIO — aborting.`);
    for (const s of check.missingSamples) {
      console.error(`  id=${s.id} key=${s.key}`);
    }
    process.exit(1);
  }
  console.log(`[wipe] all ${check.minioRows} MinIO object(s) present`);

  if (DRY_RUN) {
    console.log(`\n[wipe] Would delete ${files.length} file(s) (${fmtBytes(totalBytes)}).`);
    console.log('[wipe] Re-run with --confirm to delete.');
    await db.end();
    return;
  }

  let deleted = 0;
  let freed = 0;
  for (const { full, size } of files) {
    fs.unlinkSync(full);
    deleted++;
    freed += size;
    if (deleted % 5000 === 0) {
      console.log(`[wipe] … ${deleted} removed (${fmtBytes(freed)})`);
    }
  }
  removeEmptyDirs(DOWNLOADS_DIR);
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  console.log('\n[wipe] Summary');
  console.log(`  Files removed: ${deleted} (${fmtBytes(freed)})`);
  console.log(`  Empty downloads dir recreated at: ${DOWNLOADS_DIR}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
