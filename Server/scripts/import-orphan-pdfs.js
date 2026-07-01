#!/usr/bin/env node
/**
 * Register orphan PDFs (on disk, not in DB) with analyzed=0, dedupe by SHA-256,
 * upload unique files to MinIO, store minio:filings/<hash>.pdf
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
  isMinioEnabled,
  isMinioPath,
  parseMinioPath,
  toMinioPath,
  localPathToObjectKey,
  ensureBucket,
  objectExists,
  uploadFile,
} = require('../lib/infra/object-storage');

const DOWNLOADS_DIR = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../Scraper/downloads'),
);

const DRY_RUN = process.argv.includes('--dry-run');
const MINIO_OBJECT_PREFIX = (process.env.MINIO_FILING_PREFIX || 'filings').replace(/\/+$/, '');

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

function parseFolderName(dirName) {
  const paren = dirName.match(/\(([A-Z0-9.-]{1,12})\)\s*$/i);
  if (paren) {
    return {
      ticker: paren[1].toUpperCase(),
      nameHint: dirName.replace(/\s*\([^)]+\)\s*$/, '').replace(/_/g, ' ').trim(),
    };
  }
  if (/^[A-Z0-9.-]{1,12}$/i.test(dirName)) {
    return { ticker: dirName.toUpperCase(), nameHint: null };
  }
  return { ticker: null, nameHint: dirName.replace(/_/g, ' ').trim() };
}

async function resolveCompany(client, folderName) {
  const { ticker, nameHint } = parseFolderName(folderName);
  if (ticker) {
    const byTicker = await client.query(
      `SELECT id, name, exchange FROM companies WHERE UPPER(ticker) = $1 LIMIT 1`,
      [ticker],
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
  if (isMinioPath(pdfPath)) {
    knownPaths.add(parseMinioPath(pdfPath));
  } else {
    const resolved = path.resolve(pdfPath);
    knownPaths.add(resolved);
    const rel = localPathToObjectKey(resolved, DOWNLOADS_DIR);
    if (rel !== path.basename(resolved)) knownPaths.add(rel);
  }
}

function isKnownPath(knownPaths, objectKey, localAbs) {
  return (
    knownPaths.has(localAbs)
    || knownPaths.has(objectKey)
    || knownPaths.has(toMinioPath(objectKey))
  );
}

async function indexExistingFilings(client, knownPaths, knownHashes) {
  const { rows } = await client.query(
    `SELECT id, pdf_path, content_sha256 FROM filings WHERE pdf_path IS NOT NULL`,
  );

  let backfilled = 0;
  for (const row of rows) {
    addKnownPath(knownPaths, row.pdf_path);
    if (row.content_sha256) {
      knownHashes.add(row.content_sha256);
      continue;
    }

    let localPath = null;
    if (isMinioPath(row.pdf_path)) {
      localPath = path.join(DOWNLOADS_DIR, parseMinioPath(row.pdf_path));
    } else if (fs.existsSync(path.resolve(row.pdf_path))) {
      localPath = path.resolve(row.pdf_path);
    }

    if (!localPath || !fs.existsSync(localPath)) continue;

    const hash = await sha256File(localPath);
    knownHashes.add(hash);
    if (!DRY_RUN) {
      await client.query(
        `UPDATE filings SET content_sha256 = $1 WHERE id = $2 AND content_sha256 IS NULL`,
        [hash, row.id],
      );
      backfilled++;
    }
  }

  return { indexed: rows.length, backfilled };
}

function objectKeyForHash(hash) {
  return `${MINIO_OBJECT_PREFIX}/${hash}.pdf`;
}

async function main() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.error(`DOWNLOADS_DIR not found: ${DOWNLOADS_DIR}`);
    process.exit(1);
  }
  if (!DRY_RUN && !isMinioEnabled()) {
    console.error('MINIO_ENABLED=true required for live import (orphans are stored in MinIO).');
    process.exit(1);
  }

  const pdfs = walkPdfs(DOWNLOADS_DIR);
  console.log(`[import] ${pdfs.length} PDF(s) on disk under ${DOWNLOADS_DIR}`);
  console.log(`[import] mode: ${DRY_RUN ? 'DRY RUN' : 'IMPORT + MinIO'}`);

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
          companyRow = await resolveCompany(client, folderName);
          companyCache.set(folderName, companyRow);
        }
        if (!companyRow) {
          stats.noCompany++;
          if (stats.noCompany <= 10) {
            console.warn(`[import] no company for folder "${folderName}" (${pdfFilename})`);
          }
          continue;
        }

        const minioKey = objectKeyForHash(hash);
        const pdfPath = toMinioPath(minioKey);
        const fileSize = fs.statSync(localAbs).size;

        if (!DRY_RUN) {
          if (!(await objectExists(minioKey))) {
            await uploadFile(localAbs, minioKey);
            stats.bytes += fileSize;
          } else {
            stats.uploadSkipped++;
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
        }

        knownHashes.add(hash);
        addKnownPath(knownPaths, pdfPath);
        addKnownPath(knownPaths, localAbs);
        stats.inserted++;

        if (stats.inserted % 500 === 0) {
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
  console.log(`  MinIO upload skipped:       ${stats.uploadSkipped} (object already existed)`);
  console.log(`  No company match:           ${stats.noCompany}`);
  console.log(`  Uploaded to MinIO:          ${fmtBytes(stats.bytes)}`);
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
