#!/usr/bin/env node
/**
 * Compare local downloads, DB filings, MinIO (legacy), and AWS S3 bucket usage.
 *   node scripts/audit-filing-storage.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const aws = require('../lib/infra/aws-s3-storage');
const minio = require('../lib/infra/minio-storage');
const {
  isStorageEnabled,
  isMinioEnabled,
  isRemoteStoragePath,
  isPublicStorageUrl,
  isS3Path,
  isMinioLegacyPath,
} = require('../lib/infra/object-storage');

const { DOWNLOADS_DIR } = require('../lib/scraper/paths');

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

async function headCheckSample(urls) {
  let ok = 0;
  let fail = 0;
  for (const url of urls.slice(0, 10)) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) ok++;
      else fail++;
    } catch {
      fail++;
    }
  }
  return { ok, fail, checked: Math.min(urls.length, 10) };
}

async function main() {
  console.log('=== Filing storage audit ===\n');
  console.log('DOWNLOADS_DIR:', DOWNLOADS_DIR);
  console.log('Exists:', fs.existsSync(DOWNLOADS_DIR));
  console.log('AWS S3 enabled:', isStorageEnabled());
  console.log('MinIO enabled (legacy):', isMinioEnabled());

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

  let httpsRows = 0;
  let s3Rows = 0;
  let minioRows = 0;
  let localRows = 0;
  let localBytesInDb = 0;
  let localMissing = 0;
  const httpsUrls = [];

  for (const row of rows) {
    if (isPublicStorageUrl(row.pdf_path)) {
      httpsRows++;
      httpsUrls.push(row.pdf_path);
      continue;
    }
    if (isS3Path(row.pdf_path)) {
      s3Rows++;
      continue;
    }
    if (isMinioLegacyPath(row.pdf_path)) {
      minioRows++;
      continue;
    }
    localRows++;
    const resolved = path.resolve(row.pdf_path);
    if (fs.existsSync(resolved)) {
      localBytesInDb += fs.statSync(resolved).size;
    } else {
      localMissing++;
    }
  }

  console.log('\n--- Database (filings) ---');
  console.log(`  Total rows with pdf_path: ${rows.length}`);
  console.log(`  HTTPS (legacy public):    ${httpsRows}`);
  console.log(`  s3: paths:                ${s3Rows}`);
  console.log(`  minio: paths (legacy):    ${minioRows}`);
  console.log(`  Local paths (pending):      ${localRows}`);
  console.log(`  Local size (DB refs):       ${fmtBytes(localBytesInDb)}`);
  console.log(`  Local paths missing:        ${localMissing}`);

  const dbLocalResolved = new Set(
    rows.filter((r) => !isRemoteStoragePath(r.pdf_path)).map((r) => path.resolve(r.pdf_path)),
  );
  let orphans = 0;
  let orphanBytes = 0;
  for (const f of pdfs) {
    if (!dbLocalResolved.has(f.full)) {
      orphans++;
      orphanBytes += f.size;
    }
  }

  console.log('\n--- Orphans (PDF on disk, not a pending local DB path) ---');
  console.log(`  Count: ${orphans}  (${fmtBytes(orphanBytes)})`);
  console.log('  (Includes already-migrated filings still on disk if local copies were not deleted)');

  if (isStorageEnabled()) {
    try {
      const objects = await aws.listObjects('');
      const objBytes = objects.reduce((s, o) => s + (o.size || 0), 0);
      const pdfObjs = objects.filter((o) => o.name.toLowerCase().endsWith('.pdf'));

      console.log('\n--- AWS S3 bucket ---');
      console.log(`  Bucket: ${aws.getBucket()}`);
      console.log(`  Objects (all):  ${objects.length}  (${fmtBytes(objBytes)})`);
      console.log(`  Objects (.pdf): ${pdfObjs.length}`);

      if (httpsRows > 0 && httpsUrls.length > 0) {
        const sample = await headCheckSample(httpsUrls);
        console.log(`  HTTPS sample HEAD (${sample.checked}): ${sample.ok} OK, ${sample.fail} failed`);
      }
    } catch (err) {
      console.error('\n--- AWS S3 bucket ---');
      console.error('  Could not list bucket:', err.message);
    }
  } else {
    console.log('\n--- AWS S3 ---');
    console.log('  AWS_S3_ENABLED not set — skipping bucket listing');
  }

  if (isMinioEnabled()) {
    try {
      const objects = await minio.listObjects('');
      const objBytes = objects.reduce((s, o) => s + (o.size || 0), 0);
      const pdfObjs = objects.filter((o) => o.name.toLowerCase().endsWith('.pdf'));

      console.log('\n--- MinIO bucket (legacy) ---');
      console.log(`  Bucket: ${minio.getBucket()}`);
      console.log(`  Objects (all):  ${objects.length}  (${fmtBytes(objBytes)})`);
      console.log(`  Objects (.pdf): ${pdfObjs.length}`);

      if (minioRows > 0 && objects.length !== minioRows) {
        console.log(`  Note: ${minioRows} DB rows use minio: but bucket has ${objects.length} objects`);
      }
    } catch (err) {
      console.error('\n--- MinIO bucket ---');
      console.error('  Could not list bucket:', err.message);
    }
  }

  console.log('\n--- Likely explanation ---');
  if (minioRows > 0) {
    console.log(`  • ${minioRows} filings still use minio: — run migrate-minio-to-aws.js`);
  }
  if (localRows > 0) {
    console.log(`  • ${localRows} filings still have local pdf_path — run migrate-minio-to-aws.js --include-local`);
  }
  if (s3Rows > 0) {
    console.log(`  • ${s3Rows} filings use s3: paths (presigned access on document request).`);
  }
  if (httpsRows > 0) {
    console.log(`  • ${httpsRows} filings use legacy https: paths — re-run migration or serve via presigned redirect.`);
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
