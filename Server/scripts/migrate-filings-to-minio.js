#!/usr/bin/env node
/**
 * One-time migration: upload filing PDFs from local DOWNLOADS_DIR to MinIO
 * and update filings.pdf_path to minio:<object-key>.
 *
 * Run on the production server after MinIO is configured in Dokploy:
 *
 *   cd Server
 *   node scripts/migrate-filings-to-minio.js --dry-run
 *   node scripts/migrate-filings-to-minio.js
 *   node scripts/migrate-filings-to-minio.js --delete-local   # only after verifying
 *
 * Env (see .env.example): MINIO_ENABLED, MINIO_ENDPOINT, MINIO_ACCESS_KEY,
 * MINIO_SECRET_KEY, MINIO_BUCKET, DOWNLOADS_DIR, DATABASE_URL
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  isMinioEnabled,
  isMinioPath,
  toMinioPath,
  ensureBucket,
  localPathToObjectKey,
  objectExists,
  statObject,
  uploadFile,
} = require('../lib/infra/object-storage');

const DOWNLOADS_DIR = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../Scraper/downloads'),
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DELETE_LOCAL = args.includes('--delete-local');
const INCLUDE_ORPHANS = args.includes('--include-orphans');

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
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

async function needsUpload(localPath, objectKey) {
  if (!(await objectExists(objectKey))) return true;
  const localSize = fs.statSync(localPath).size;
  const remote = await statObject(objectKey);
  return remote.size !== localSize;
}

async function migrateDbRows(stats) {
  const { rows } = await db.query(`
    SELECT id, pdf_path, pdf_filename
    FROM filings
    WHERE pdf_path IS NOT NULL
      AND pdf_path NOT LIKE 'minio:%'
    ORDER BY id
  `);

  console.log(`[migrate] ${rows.length} DB row(s) with local pdf_path`);

  for (const row of rows) {
    const localPath = path.resolve(row.pdf_path);
    if (!fs.existsSync(localPath)) {
      stats.missingLocal++;
      if (stats.missingLocal <= 10) {
        console.warn(`[migrate] missing file id=${row.id}: ${localPath}`);
      }
      continue;
    }

    const objectKey = localPathToObjectKey(localPath, DOWNLOADS_DIR);
    const minioPath = toMinioPath(objectKey);

    try {
      if (!DRY_RUN) {
        if (await needsUpload(localPath, objectKey)) {
          await uploadFile(localPath, objectKey);
          stats.uploaded++;
          stats.bytes += fs.statSync(localPath).size;
        } else {
          stats.skippedExists++;
        }

        await db.query('UPDATE filings SET pdf_path = $1 WHERE id = $2', [minioPath, row.id]);

        if (DELETE_LOCAL) {
          fs.unlinkSync(localPath);
          stats.deletedLocal++;
        }
      } else {
        stats.wouldUpload++;
        stats.bytes += fs.statSync(localPath).size;
      }
      stats.updatedDb++;
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 15 || stats.errors % 100 === 0) {
        console.error(`[migrate] failed id=${row.id} ${objectKey}:`, err.code || err.name, err.message);
      }
    }

    if (stats.updatedDb % 250 === 0 && stats.updatedDb > 0) {
      console.log(`[migrate] progress: ${stats.updatedDb} rows processed…`);
    }
  }
}

async function migrateOrphanPdfs(stats) {
  const pdfs = walkPdfs(DOWNLOADS_DIR);
  console.log(`[migrate] scanning ${pdfs.length} PDF(s) on disk for orphans`);

  for (const localPath of pdfs) {
    const objectKey = localPathToObjectKey(localPath, DOWNLOADS_DIR);
    const minioPath = toMinioPath(objectKey);

    const existing = await db.query(
      'SELECT id FROM filings WHERE pdf_path = $1 OR pdf_path = $2 LIMIT 1',
      [localPath, minioPath],
    );
    if (existing.rows.length > 0) continue;

    try {
      if (!DRY_RUN) {
        if (await needsUpload(localPath, objectKey)) {
          await uploadFile(localPath, objectKey);
          stats.orphansUploaded++;
          stats.bytes += fs.statSync(localPath).size;
        }
        if (DELETE_LOCAL) {
          fs.unlinkSync(localPath);
          stats.deletedLocal++;
        }
      } else {
        stats.wouldUploadOrphans++;
      }
    } catch (err) {
      stats.errors++;
      console.error(`[migrate] orphan failed ${objectKey}:`, err.message);
    }
  }
}

async function main() {
  if (!isMinioEnabled()) {
    console.error('[migrate] MinIO is not configured. Set MINIO_ENABLED=true and credentials in .env');
    process.exit(1);
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.error(`[migrate] DOWNLOADS_DIR not found: ${DOWNLOADS_DIR}`);
    process.exit(1);
  }

  console.log('[migrate] MinIO filing migration');
  console.log(`  downloads: ${DOWNLOADS_DIR}`);
  console.log(`  bucket:    ${process.env.MINIO_BUCKET}`);
  console.log(`  endpoint:  ${process.env.MINIO_ENDPOINT}`);
  console.log(`  delay:     ${process.env.MINIO_UPLOAD_DELAY_MS || '75'}ms between uploads`);
  console.log(`  mode:      ${DRY_RUN ? 'DRY RUN' : DELETE_LOCAL ? 'LIVE + delete local' : 'LIVE'}`);
  console.log('  tip:       use internal MINIO_ENDPOINT=minio:9000 if public URL rate-limits');

  if (!DRY_RUN) {
    try {
      await ensureBucket();
    } catch (err) {
      console.error('[migrate] MinIO connection failed:', err.code || err.name, err.message);
      console.error('[migrate] Run: node scripts/test-minio-connection.js');
      process.exit(1);
    }
  }

  const stats = {
    updatedDb: 0,
    uploaded: 0,
    skippedExists: 0,
    missingLocal: 0,
    wouldUpload: 0,
    orphansUploaded: 0,
    wouldUploadOrphans: 0,
    deletedLocal: 0,
    errors: 0,
    bytes: 0,
  };

  await migrateDbRows(stats);
  if (INCLUDE_ORPHANS) await migrateOrphanPdfs(stats);

  console.log('\n[migrate] Summary');
  console.log(`  DB rows updated:     ${stats.updatedDb}`);
  console.log(`  Uploaded:            ${DRY_RUN ? stats.wouldUpload : stats.uploaded}`);
  console.log(`  Already in MinIO:    ${stats.skippedExists}`);
  console.log(`  Missing local file:  ${stats.missingLocal}`);
  if (INCLUDE_ORPHANS) {
    console.log(`  Orphans uploaded:    ${DRY_RUN ? stats.wouldUploadOrphans : stats.orphansUploaded}`);
  }
  if (DELETE_LOCAL) console.log(`  Local files deleted: ${stats.deletedLocal}`);
  console.log(`  Data transferred:    ${fmtBytes(stats.bytes)}`);
  console.log(`  Errors:              ${stats.errors}`);

  if (DRY_RUN) {
    console.log('\n[migrate] Dry run complete — re-run without --dry-run to upload.');
  } else if (stats.errors > 0) {
    console.log('\n[migrate] Partial run — safe to re-run; already-migrated rows (minio:…) are skipped.');
    console.log('  If errors persist, switch backend .env to internal MinIO:');
    console.log('    MINIO_ENDPOINT=minio  MINIO_PORT=9000  MINIO_USE_SSL=false');
    console.log('  Or slow public uploads: MINIO_UPLOAD_DELAY_MS=200');
  } else if (!DELETE_LOCAL) {
    console.log('\n[migrate] Verify PDFs in MinIO and /api/filings/:id/document, then optionally:');
    console.log('  node scripts/migrate-filings-to-minio.js --delete-local');
  }

  await db.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
