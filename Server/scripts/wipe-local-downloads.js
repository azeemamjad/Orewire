#!/usr/bin/env node
/**
 * Delete all files under DOWNLOADS_DIR after verifying every DB filing exists in S3.
 *
 *   node scripts/wipe-local-downloads.js --dry-run
 *   node scripts/wipe-local-downloads.js --confirm
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  isStorageEnabled,
  isRemoteStoragePath,
  parseStoragePath,
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

async function verifyRemoteFilings(rows) {
  const remoteRows = rows.filter((r) => isRemoteStoragePath(r.pdf_path));
  let missing = 0;
  const missingSamples = [];

  for (let i = 0; i < remoteRows.length; i++) {
    const row = remoteRows[i];
    const key = parseStoragePath(row.pdf_path);
    if (!key || !(await objectExists(key))) {
      missing++;
      if (missingSamples.length < 10) {
        missingSamples.push({ id: row.id, key });
      }
    }
    if ((i + 1) % 2000 === 0) {
      console.log(`[wipe] verified ${i + 1}/${remoteRows.length} S3 object(s)…`);
    }
  }

  return { remoteRows: remoteRows.length, missing, missingSamples };
}

async function main() {
  if (!DRY_RUN && !CONFIRM) {
    console.error('Pass --dry-run to preview or --confirm to delete (irreversible).');
    process.exit(1);
  }
  if (!isStorageEnabled()) {
    console.error('AWS_S3_ENABLED=true required before wiping local copies.');
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
  const localDbRows = rows.filter((r) => !isRemoteStoragePath(r.pdf_path));
  if (localDbRows.length > 0) {
    console.error(`[wipe] ${localDbRows.length} filing(s) still use local pdf_path — upload to S3 first.`);
    process.exit(1);
  }

  console.log(`[wipe] verifying ${rows.length} S3-backed filing(s)…`);
  const check = await verifyRemoteFilings(rows);
  if (check.missing > 0) {
    console.error(`[wipe] ${check.missing} DB filing(s) missing from S3 — aborting.`);
    for (const s of check.missingSamples) {
      console.error(`  id=${s.id} key=${s.key}`);
    }
    process.exit(1);
  }
  console.log(`[wipe] all ${check.remoteRows} S3 object(s) present`);

  if (DRY_RUN) {
    console.log(`\n[wipe] Would delete ${files.length} file(s) (${fmtBytes(totalBytes)}).`);
    console.log('[wipe] Re-run with --confirm to delete.');
    await db.end();
    return;
  }

  for (const f of files) {
    fs.unlinkSync(f.full);
  }
  removeEmptyDirs(DOWNLOADS_DIR);
  console.log(`[wipe] deleted ${files.length} file(s) (${fmtBytes(totalBytes)})`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
