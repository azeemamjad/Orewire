#!/usr/bin/env node
/**
 * Remove local PDF copies that are already in MinIO (DB pdf_path = minio:…).
 * Does NOT delete orphan PDFs (files on disk with no DB row) unless --orphans.
 *
 *   node scripts/prune-migrated-local-pdfs.js --dry-run
 *   node scripts/prune-migrated-local-pdfs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  isMinioEnabled,
  isMinioPath,
  parseMinioPath,
  statObject,
} = require('../lib/infra/object-storage');

const DOWNLOADS_DIR = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../Scraper/downloads'),
);

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE_ORPHANS = process.argv.includes('--orphans');

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  return `${n} B`;
}

async function main() {
  if (!isMinioEnabled()) {
    console.error('MINIO_ENABLED required');
    process.exit(1);
  }

  const { rows } = await db.query(`
    SELECT id, pdf_path FROM filings
    WHERE pdf_path LIKE 'minio:%'
    ORDER BY id
  `);

  let deleted = 0;
  let freed = 0;
  let missing = 0;
  let mismatch = 0;
  let errors = 0;

  console.log(`[prune] ${rows.length} minio filing(s); downloads: ${DOWNLOADS_DIR}`);
  console.log(`[prune] mode: ${DRY_RUN ? 'DRY RUN' : 'DELETE'}`);

  for (const row of rows) {
    const key = parseMinioPath(row.pdf_path);
    const localPath = path.join(DOWNLOADS_DIR, key);
    if (!fs.existsSync(localPath)) {
      missing++;
      continue;
    }
    try {
      const localSize = fs.statSync(localPath).size;
      const remote = await statObject(key);
      if (remote.size !== localSize) {
        mismatch++;
        if (mismatch <= 5) {
          console.warn(`[prune] size mismatch id=${row.id}: local=${localSize} remote=${remote.size} ${key}`);
        }
        continue;
      }
      if (!DRY_RUN) fs.unlinkSync(localPath);
      deleted++;
      freed += localSize;
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`[prune] id=${row.id}:`, err.message);
    }

    if (deleted % 500 === 0 && deleted > 0) {
      console.log(`[prune] … ${deleted} removed (${fmtBytes(freed)})`);
    }
  }

  let orphanDeleted = 0;
  let orphanFreed = 0;
  if (DELETE_ORPHANS) {
    console.warn('[prune] --orphans: scanning entire downloads tree (not in DB as local path)');
    const { rows: allPaths } = await db.query(`SELECT pdf_path FROM filings WHERE pdf_path IS NOT NULL`);
    const minioKeys = new Set(
      allPaths.filter((r) => isMinioPath(r.pdf_path)).map((r) => parseMinioPath(r.pdf_path)),
    );

    function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.toLowerCase().endsWith('.pdf')) {
          const rel = path.relative(DOWNLOADS_DIR, full).split(path.sep).join('/');
          if (!minioKeys.has(rel)) {
            const sz = fs.statSync(full).size;
            if (!DRY_RUN) fs.unlinkSync(full);
            orphanDeleted++;
            orphanFreed += sz;
          }
        }
      }
    }
    if (fs.existsSync(DOWNLOADS_DIR)) walk(DOWNLOADS_DIR);
  }

  console.log('\n[prune] Summary');
  console.log(`  Migrated copies removed: ${deleted} (${fmtBytes(freed)})`);
  console.log(`  Local already gone:      ${missing}`);
  console.log(`  Size mismatch (kept):  ${mismatch}`);
  console.log(`  Errors:                  ${errors}`);
  if (DELETE_ORPHANS) {
    console.log(`  Orphans removed:         ${orphanDeleted} (${fmtBytes(orphanFreed)})`);
  } else {
    console.log('\n  Orphan PDFs on disk were NOT touched.');
    console.log('  ~36k+ files may remain — scraped but never imported into filings table.');
    console.log('  To delete those too (irreversible): --orphans');
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
