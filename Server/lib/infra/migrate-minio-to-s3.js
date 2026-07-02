const fs = require('fs');
const path = require('path');
const db = require('../../db');
const minio = require('./minio-storage');
const aws = require('./aws-s3-storage');
const {
  localPathToObjectKey,
  parseMinioLegacyPath,
  parseStoragePath,
  getFilingPrefix,
  toDbStoragePath,
  usePresignedUrls,
} = require('./object-storage');

const { DOWNLOADS_DIR } = require('../scraper/paths');

function emptyStats() {
  return {
    copied: 0,
    skippedExists: 0,
    wouldCopy: 0,
    dbUpdated: 0,
    wouldUpdateDb: 0,
    orphansCopied: 0,
    missingLocal: 0,
    errors: 0,
    bytes: 0,
  };
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function createProgressEmitter(onProgress, stats) {
  return (payload) => {
    if (typeof onProgress === 'function') {
      onProgress({ stats: { ...stats }, ...payload });
    }
  };
}

async function copyMinioToS3(objectKey, stats, { dryRun, verifyOnly, emit }) {
  if (await aws.objectExists(objectKey)) {
    stats.skippedExists++;
    return toDbStoragePath(objectKey);
  }

  if (dryRun || verifyOnly) {
    stats.wouldCopy++;
    return toDbStoragePath(objectKey);
  }

  const minioStat = await minio.statObject(objectKey);
  const stream = await minio.getObjectStream(objectKey);
  await aws.uploadStream(stream, objectKey, {
    contentType: minioStat.metaData?.['content-type'] || 'application/pdf',
  });

  const s3Head = await aws.headObject(objectKey);
  if (s3Head.size !== minioStat.size) {
    throw new Error(`size mismatch after upload: minio=${minioStat.size} s3=${s3Head.size}`);
  }

  stats.copied++;
  stats.bytes += minioStat.size;
  emit?.({ message: `Copied ${objectKey} (${fmtBytes(minioStat.size)})` });
  return toDbStoragePath(objectKey);
}

async function migrateMinioDbRows(stats, opts, emit, shouldCancel) {
  const { dryRun, verifyOnly } = opts;
  const { rows } = await db.query(`
    SELECT id, pdf_path, pdf_filename
    FROM filings
    WHERE pdf_path LIKE 'minio:%'
    ORDER BY id
  `);

  const total = rows.length;
  emit?.({ phase: 'minio_rows', processed: 0, total, message: `Phase A: ${total} minio: row(s)` });

  let processed = 0;
  for (const row of rows) {
    if (shouldCancel?.()) throw new Error('Migration cancelled');

    const objectKey = parseMinioLegacyPath(row.pdf_path);
    if (!objectKey) {
      stats.errors++;
      processed++;
      continue;
    }

    try {
      const dbPath = await copyMinioToS3(objectKey, stats, { dryRun, verifyOnly, emit });

      if (!dryRun && !verifyOnly) {
        await db.query('UPDATE filings SET pdf_path = $1 WHERE id = $2', [dbPath, row.id]);
        stats.dbUpdated++;
      } else {
        stats.wouldUpdateDb++;
      }
    } catch (err) {
      stats.errors++;
      emit?.({ message: `Failed id=${row.id} ${objectKey}: ${err.message}`, level: 'error' });
    }

    processed++;
    if (processed % 25 === 0 || processed === total) {
      emit?.({ phase: 'minio_rows', processed, total });
    }
  }
}

async function migrateOrphanMinioObjects(stats, referencedKeys, opts, emit, shouldCancel) {
  const { dryRun, verifyOnly } = opts;
  const prefix = `${getFilingPrefix()}/`;
  const objects = await minio.listObjects(prefix);
  const orphans = objects.filter((o) => o.name && !referencedKeys.has(o.name));
  const total = orphans.length;

  emit?.({ phase: 'orphans', processed: 0, total, message: `Phase B: ${total} orphan object(s)` });

  let processed = 0;
  for (const obj of orphans) {
    if (shouldCancel?.()) throw new Error('Migration cancelled');
    try {
      await copyMinioToS3(obj.name, stats, { dryRun, verifyOnly, emit });
      stats.orphansCopied++;
    } catch (err) {
      stats.errors++;
      emit?.({ message: `Orphan failed ${obj.name}: ${err.message}`, level: 'error' });
    }
    processed++;
    if (processed % 25 === 0 || processed === total) {
      emit?.({ phase: 'orphans', processed, total });
    }
  }
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

async function needsLocalUpload(localPath, objectKey) {
  if (!(await aws.objectExists(objectKey))) return true;
  const localSize = fs.statSync(localPath).size;
  const remote = await aws.headObject(objectKey);
  return remote.size !== localSize;
}

async function migrateLocalDbRows(stats, opts, emit, shouldCancel) {
  const { dryRun, verifyOnly } = opts;
  const { rows } = await db.query(`
    SELECT id, pdf_path, pdf_filename
    FROM filings
    WHERE pdf_path IS NOT NULL
      AND pdf_path NOT LIKE 'minio:%'
      AND pdf_path NOT LIKE 's3:%'
      AND pdf_path NOT LIKE 'https://%'
    ORDER BY id
  `);

  const total = rows.length;
  emit?.({ phase: 'local_rows', processed: 0, total, message: `Phase C: ${total} local row(s)` });

  let processed = 0;
  for (const row of rows) {
    if (shouldCancel?.()) throw new Error('Migration cancelled');

    const localPath = path.resolve(row.pdf_path);
    if (!fs.existsSync(localPath)) {
      stats.missingLocal++;
      processed++;
      continue;
    }

    const objectKey = localPathToObjectKey(localPath, DOWNLOADS_DIR);

    try {
      let dbPath;
      if (dryRun || verifyOnly) {
        dbPath = toDbStoragePath(objectKey);
        stats.wouldUpdateDb++;
      } else if (await needsLocalUpload(localPath, objectKey)) {
        await aws.uploadFile(localPath, objectKey);
        stats.copied++;
        stats.bytes += fs.statSync(localPath).size;
        dbPath = toDbStoragePath(objectKey);
        await db.query('UPDATE filings SET pdf_path = $1 WHERE id = $2', [dbPath, row.id]);
        stats.dbUpdated++;
      } else {
        stats.skippedExists++;
        dbPath = toDbStoragePath(objectKey);
        await db.query('UPDATE filings SET pdf_path = $1 WHERE id = $2', [dbPath, row.id]);
        stats.dbUpdated++;
      }
    } catch (err) {
      stats.errors++;
      emit?.({ message: `Local failed id=${row.id} ${objectKey}: ${err.message}`, level: 'error' });
    }

    processed++;
    if (processed % 25 === 0 || processed === total) {
      emit?.({ phase: 'local_rows', processed, total });
    }
  }
}

async function verifySample(emit) {
  const { rows } = await db.query(`
    SELECT id, pdf_path FROM filings
    WHERE pdf_path LIKE 's3:%' OR pdf_path LIKE 'https://%'
    ORDER BY RANDOM()
    LIMIT 5
  `);

  emit?.({ message: `Verify: checking ${rows.length} random row(s) on S3` });
  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const key = parseStoragePath(row.pdf_path);
    if (!key) {
      fail++;
      continue;
    }
    try {
      const head = await aws.headObject(key);
      if (head.size > 0) {
        ok++;
        emit?.({ message: `Verify OK id=${row.id} ${key} (${fmtBytes(head.size)})` });
      } else {
        fail++;
      }
    } catch (err) {
      fail++;
      emit?.({ message: `Verify FAIL id=${row.id}: ${err.message}`, level: 'error' });
    }
  }

  return { ok, fail };
}

async function runMigration(options = {}, onProgress) {
  const opts = {
    dryRun: false,
    verifyOnly: false,
    includeOrphans: false,
    includeLocal: false,
    shouldCancel: () => false,
    ...options,
  };

  if (!minio.isMinioEnabled() && !opts.includeLocal) {
    throw new Error('MinIO source not configured (MINIO_ENABLED=true and credentials)');
  }
  if (!aws.isAwsS3Enabled()) {
    throw new Error('AWS S3 target not configured (AWS_S3_ENABLED=true and credentials)');
  }

  const stats = emptyStats();
  const emit = createProgressEmitter(onProgress, stats);

  emit({
    phase: 'init',
    message: `MinIO → S3 | dryRun=${opts.dryRun} presigned=${usePresignedUrls()}`,
  });

  if (!opts.dryRun && !opts.verifyOnly) {
    if (minio.isMinioEnabled()) await minio.ensureBucket();
    await aws.ensureBucket();
  }

  if (opts.verifyOnly) {
    const verify = await verifySample(emit);
    return { stats, verify };
  }

  if (minio.isMinioEnabled()) {
    await migrateMinioDbRows(stats, opts, emit, opts.shouldCancel);

    if (opts.includeOrphans) {
      const { rows } = await db.query(`
        SELECT pdf_path FROM filings
        WHERE pdf_path LIKE 'minio:%' OR pdf_path LIKE 's3:%' OR pdf_path LIKE 'https://%'
      `);
      const referencedKeys = new Set();
      for (const row of rows) {
        const key = parseStoragePath(row.pdf_path);
        if (key) referencedKeys.add(key);
      }
      await migrateOrphanMinioObjects(stats, referencedKeys, opts, emit, opts.shouldCancel);
    }
  }

  if (opts.includeLocal) {
    await migrateLocalDbRows(stats, opts, emit, opts.shouldCancel);
  }

  if (!opts.dryRun && stats.errors === 0) {
    await verifySample(emit);
  }

  emit({ phase: 'done', message: 'Migration finished', processed: 1, total: 1 });
  return { stats };
}

module.exports = {
  runMigration,
  emptyStats,
  fmtBytes,
};
