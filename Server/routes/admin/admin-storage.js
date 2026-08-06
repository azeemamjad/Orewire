const express = require('express');
const db = require('../../db');
const aws = require('../../lib/infra/aws-s3-storage');
const {
  getFilingPrefix,
  usePresignedUrls,
  presignExpiresSec,
  isStorageEnabled,
} = require('../../lib/infra/object-storage');

const {
  startMigration,
  stopMigration,
  getStatus: migrationStatus,
  scanLocalDisk,
} = require('../../lib/infra/storage-migration');

const router = express.Router();

/**
 * Whole-bucket stats, split by the configured filing prefix.
 *
 * The pipeline writes DOWNLOADS_DIR-relative keys ("ABX/ABX_2025….pdf") and does
 * not apply STORAGE_FILING_PREFIX, while scripts/import-orphan-pdfs.js writes
 * "filings/<sha256>.pdf". Listing only the prefix therefore reported the legacy
 * import corpus and none of the live objects, which read as "S3 is not working".
 */
async function bucketStats(listFn, prefix = '') {
  const objects = await listFn('');
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  const matchesPrefix = (o) => !normalizedPrefix || (o.name || '').startsWith(`${normalizedPrefix}/`);
  const inPrefix = objects.filter(matchesPrefix);
  const outsidePrefix = objects.filter((o) => !matchesPrefix(o));
  const sum = (list) => list.reduce((s, o) => s + (o.size || 0), 0);
  const pdfs = objects.filter((o) => (o.name || '').toLowerCase().endsWith('.pdf'));

  return {
    objects: objects.length,
    pdfObjects: pdfs.length,
    bytes: sum(objects),
    prefix: normalizedPrefix,
    inPrefix: { objects: inPrefix.length, bytes: sum(inPrefix) },
    outsidePrefix: { objects: outsidePrefix.length, bytes: sum(outsidePrefix) },
  };
}

// Listing the whole bucket is ~40 paginated calls, so hold the result briefly.
// Volume figures do not move minute to minute; ?refresh=1 forces a re-list.
const BUCKET_CACHE_MS = 5 * 60 * 1000;
let bucketCache = null;

async function cachedBucketStats(prefix, { force = false } = {}) {
  const fresh = bucketCache && Date.now() - bucketCache.at < BUCKET_CACHE_MS;
  if (fresh && !force) return { ...bucketCache.stats, cachedAt: bucketCache.at };
  const stats = await bucketStats((p) => aws.listObjects(p), prefix);
  bucketCache = { at: Date.now(), stats };
  return { ...stats, cachedAt: bucketCache.at };
}

async function dbPathCounts() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE pdf_path LIKE 's3:%') AS s3_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 'minio:%') AS legacy_minio_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 'https://%') AS https_rows,
      COUNT(*) FILTER (
        WHERE pdf_path IS NOT NULL
          AND pdf_path NOT LIKE 'minio:%'
          AND pdf_path NOT LIKE 's3:%'
          AND pdf_path NOT LIKE 'https://%'
      ) AS local_rows,
      COUNT(*) FILTER (WHERE pdf_path IS NOT NULL) AS total
    FROM filings
  `);
  return rows[0] || {
    s3_rows: 0, legacy_minio_rows: 0, https_rows: 0, local_rows: 0, total: 0,
  };
}

async function testConnection(enabled, testFn) {
  if (!enabled) return { ok: false, error: 'Not configured' };
  try {
    await testFn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// GET /api/admin/storage/summary
router.get('/summary', async (req, res) => {
  try {
    const dbCounts = await dbPathCounts();
    const prefix = `${getFilingPrefix()}/`;

    const s3Conn = await testConnection(isStorageEnabled(), () => aws.ensureBucket());

    let s3Stats = null;
    if (s3Conn.ok) {
      try {
        s3Stats = await cachedBucketStats(prefix, { force: req.query.refresh === '1' });
      } catch (err) {
        s3Stats = { error: err.message };
      }
    }

    let local = null;
    try {
      local = await scanLocalDisk();
    } catch (err) {
      local = { error: err.message };
    }

    res.json({
      config: {
        filingPrefix: getFilingPrefix(),
        presignedUrls: usePresignedUrls(),
        presignExpiresSec: presignExpiresSec(),
        s3Bucket: isStorageEnabled() ? aws.getBucket() : null,
        s3Region: isStorageEnabled() ? aws.getRegion() : null,
      },
      connections: { s3: s3Conn },
      db: dbCounts,
      s3: s3Stats,
      local,
      migration: migrationStatus(),
    });
  } catch (err) {
    console.error('[storage] summary failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Migration / disk reclaim ────────────────────────────────────────────────

// GET /api/admin/storage/migration/status — poll while a job runs
router.get('/migration/status', (_req, res) => {
  res.json(migrationStatus());
});

// POST /api/admin/storage/migration/start
// { mode: 'upload' | 'prune', dryRun?: boolean, includeOrphans?: boolean }
router.post('/migration/start', express.json(), (req, res) => {
  const mode = req.body?.mode === 'upload' ? 'upload' : 'prune';
  const dryRun = req.body?.dryRun === true;
  const includeOrphans = req.body?.includeOrphans === true;

  const result = startMigration({ mode, dryRun, includeOrphans });
  if (!result.started) {
    const messages = {
      already_running: 'A storage job is already running',
      storage_disabled: 'AWS S3 is not configured (set AWS_S3_ENABLED=true)',
      invalid_mode: 'mode must be "upload" or "prune"',
    };
    return res.status(409).json({
      error: messages[result.reason] || 'Could not start job',
      reason: result.reason,
      status: result.status,
    });
  }
  return res.json(result);
});

// POST /api/admin/storage/migration/stop — graceful stop after the current file
router.post('/migration/stop', (_req, res) => {
  res.json(stopMigration());
});

module.exports = router;
