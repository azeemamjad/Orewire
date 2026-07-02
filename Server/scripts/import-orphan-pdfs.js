#!/usr/bin/env node
/**
 * Register orphan PDFs (on disk, not in DB) with analyzed=0, dedupe by SHA-256,
 * upload unique files to S3, store public HTTPS URL in pdf_path
 *
 *   node scripts/import-orphan-pdfs.js --dry-run
 *   node scripts/import-orphan-pdfs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const migrate = require('../db/migrate');
const {
  isStorageEnabled,
  isRemoteStoragePath,
  isMinioLegacyPath,
  parseStoragePath,
  toStoragePath,
  toMinioLegacyPath,
  getFilingPrefix,
  localPathToObjectKey,
  ensureBucket,
  objectExists,
  persistFilingPdf,
} = require('../lib/infra/object-storage');

const { DOWNLOADS_DIR } = require('../lib/scraper/paths');

const DRY_RUN = process.argv.includes('--dry-run');
const MINIO_OBJECT_PREFIX = getFilingPrefix();

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  return `${n} B`;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function walkPdfs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkPdfs(full, out);
    else if (name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

function normalizeNameHint(dirName) {
  return dirName
    .replace(/_+$/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tickerFromFilename(filename) {
  const m = filename.match(/_-_{1,2}([A-Z][A-Z0-9]{1,5})_/i);
  return m ? m[1].toUpperCase() : null;
}

function parseFolderName(dirName) {
  const paren = dirName.match(/\(([A-Z0-9.-]{1,12})\)\s*$/i);
  if (paren) {
    return {
      ticker: paren[1].toUpperCase(),
      nameHint: normalizeNameHint(dirName.replace(/\s*\([^)]+\)\s*$/, '')),
    };
  }
  if (/^[A-Z0-9.-]{1,12}$/i.test(dirName)) {
    return { ticker: dirName.toUpperCase(), nameHint: null };
  }
  return { ticker: null, nameHint: normalizeNameHint(dirName) };
}

async function resolveCompany(client, folderName, pdfFilename = null) {
  const { ticker, nameHint } = parseFolderName(folderName);
  const tickers = [ticker, tickerFromFilename(pdfFilename)].filter(Boolean);
  for (const t of [...new Set(tickers)]) {
    const byTicker = await client.query(
      `SELECT id, name, exchange FROM companies
       WHERE UPPER(ticker) = $1 OR UPPER(sedar_ticker) = $1
       LIMIT 1`,
      [t],
    );
    if (byTicker.rows[0]) return byTicker.rows[0];
  }
  if (nameHint) {
    const exact = await client.query(
      `SELECT id, name, exchange FROM companies WHERE name ILIKE $1 LIMIT 1`,
      [nameHint],
    );
    if (exact.rows[0]) return exact.rows[0];
    const fuzzy = await client.query(
      `SELECT id, name, exchange FROM companies WHERE name ILIKE $1 ORDER BY market_cap DESC NULLS LAST LIMIT 1`,
      [`%${nameHint}%`],
    );
    if (fuzzy.rows[0]) return fuzzy.rows[0];
  }
  return null;
}

function addKnownPath(knownPaths, pdfPath) {
  if (!pdfPath) return;
  knownPaths.add(pdfPath);
  if (isRemoteStoragePath(pdfPath)) {
    knownPaths.add(parseStoragePath(pdfPath));
  } else {
    const resolved = path.resolve(pdfPath);
    knownPaths.add(resolved);
    const rel = localPathToObjectKey(resolved, DOWNLOADS_DIR);
    if (rel !== path.basename(resolved)) knownPaths.add(rel);
  }
}

function isKnownPath(knownPaths, objectKey, localAbs) {
  if (knownPaths.has(localAbs) || knownPaths.has(objectKey)) return true;
  if (knownPaths.has(toMinioLegacyPath(objectKey))) return true;
  if (isStorageEnabled()) {
    return knownPaths.has(toStoragePath(objectKey));
  }
  return false;
}

async function indexExistingFilings(client, knownPaths, knownHashes) {
  const { rows } = await client.query(
    `SELECT id, pdf_path, content_sha256 FROM filings WHERE pdf_path IS NOT NULL`,
  );

  let backfilled = 0;
  let backfillSkipped = 0;
  for (const row of rows) {
    addKnownPath(knownPaths, row.pdf_path);
    if (row.content_sha256) {
      knownHashes.add(row.content_sha256);
      continue;
    }

    let localPath = null;
    if (isMinioLegacyPath(row.pdf_path)) {
      localPath = path.join(DOWNLOADS_DIR, parseStoragePath(row.pdf_path));
    } else if (fs.existsSync(path.resolve(row.pdf_path))) {
      localPath = path.resolve(row.pdf_path);
    }

    if (!localPath || !fs.existsSync(localPath)) continue;

    const hash = await sha256File(localPath);
    knownHashes.add(hash);
    if (!DRY_RUN) {
      const upd = await client.query(
        `UPDATE filings SET content_sha256 = $1
         WHERE id = $2 AND content_sha256 IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM filings f2
             WHERE f2.content_sha256 = $1 AND f2.id <> $2
           )
         RETURNING id`,
        [hash, row.id],
      );
      if (upd.rows.length > 0) backfilled++;
      else backfillSkipped++;
    }
  }

  return { indexed: rows.length, backfilled, backfillSkipped };
}

function objectKeyForHash(hash) {
  return `${MINIO_OBJECT_PREFIX}/${hash}.pdf`;
}

async function main() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.error(`DOWNLOADS_DIR not found: ${DOWNLOADS_DIR}`);
    process.exit(1);
  }
  if (!DRY_RUN && !isStorageEnabled()) {
    console.error('AWS_S3_ENABLED=true required for live import (orphans are stored in S3).');
    process.exit(1);
  }

  const pdfs = walkPdfs(DOWNLOADS_DIR);
  console.log(`[import] ${pdfs.length} PDF(s) on disk under ${DOWNLOADS_DIR}`);
  console.log(`[import] mode: ${DRY_RUN ? 'DRY RUN' : 'IMPORT + S3'}`);

  const client = await db.connect();
  const knownPaths = new Set();
  const knownHashes = new Set();
  const companyCache = new Map();

  const stats = {
    inserted: 0,
    skippedPath: 0,
    skippedDuplicate: 0,
    noCompany: 0,
    uploadSkipped: 0,
    errors: 0,
    bytes: 0,
  };

  try {
    await migrate();
    const index = await indexExistingFilings(client, knownPaths, knownHashes);
    console.log(`[import] indexed ${index.indexed} existing filing(s); hashes known: ${knownHashes.size}`);
    if (index.backfilled > 0) {
      console.log(`[import] backfilled content_sha256 on ${index.backfilled} row(s)`);
    }
    if (index.backfillSkipped > 0) {
      console.log(`[import] skipped backfill on ${index.backfillSkipped} duplicate-content row(s)`);
    }

    if (!DRY_RUN) await ensureBucket();

    for (const localAbs of pdfs) {
      const objectKey = localPathToObjectKey(localAbs, DOWNLOADS_DIR);
      const folderName = path.basename(path.dirname(localAbs));
      const pdfFilename = path.basename(localAbs);

      try {
        if (isKnownPath(knownPaths, objectKey, localAbs)) {
          stats.skippedPath++;
          continue;
        }

        const hash = await sha256File(localAbs);
        if (knownHashes.has(hash)) {
          stats.skippedDuplicate++;
          continue;
        }

        let companyRow = companyCache.get(folderName);
        if (companyRow === undefined) {
          companyRow = await resolveCompany(client, folderName, pdfFilename);
          companyCache.set(folderName, companyRow);
        }
        if (!companyRow) {
          stats.noCompany++;
          if (stats.noCompany <= 10) {
            console.warn(`[import] no company for folder "${folderName}" (${pdfFilename})`);
          }
          continue;
        }

        const storageKey = objectKeyForHash(hash);
        const fileSize = fs.statSync(localAbs).size;

        if (DRY_RUN) {
          knownHashes.add(hash);
          stats.inserted++;
        } else {
          const alreadyExists = await objectExists(storageKey);
          const pdfPath = await persistFilingPdf(localAbs, storageKey);
          if (alreadyExists) {
            stats.uploadSkipped++;
          } else {
            stats.bytes += fileSize;
          }

          const ins = await client.query(
            `INSERT INTO filings
              (company_id, company_name, pdf_filename, pdf_path, exchange, analyzed, status, content_sha256)
             VALUES ($1, $2, $3, $4, $5, 0, 'downloaded', $6)
             ON CONFLICT (content_sha256) DO NOTHING
             RETURNING id`,
            [
              companyRow.id,
              companyRow.name,
              pdfFilename,
              pdfPath,
              companyRow.exchange,
              hash,
            ],
          );
          if (ins.rows.length === 0) {
            stats.skippedDuplicate++;
            continue;
          }

          knownHashes.add(hash);
          addKnownPath(knownPaths, pdfPath);
          addKnownPath(knownPaths, localAbs);
          stats.inserted++;
        }

        if (stats.inserted % 500 === 0 && stats.inserted > 0) {
          console.log(`[import] … ${stats.inserted} unique orphan(s) registered (${fmtBytes(stats.bytes)} uploaded)`);
        }
      } catch (err) {
        stats.errors++;
        if (stats.errors <= 15) {
          console.error(`[import] ${objectKey}:`, err.message);
        }
      }
    }
  } finally {
    client.release();
  }

  console.log('\n[import] Summary');
  console.log(`  Unique orphans registered:  ${stats.inserted}`);
  console.log(`  Skipped (path in DB):       ${stats.skippedPath}`);
  console.log(`  Skipped (duplicate content): ${stats.skippedDuplicate}`);
  console.log(`  S3 upload skipped:          ${stats.uploadSkipped} (object already existed)`);
  console.log(`  No company match:           ${stats.noCompany}`);
  console.log(`  Uploaded to S3:             ${fmtBytes(stats.bytes)}`);
  console.log(`  Errors:                     ${stats.errors}`);

  if (DRY_RUN) {
    console.log('\n[import] Dry run — re-run without --dry-run to write DB + MinIO.');
  }

  await db.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
