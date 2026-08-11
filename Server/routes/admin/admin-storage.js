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

const orphans = require('../../lib/infra/orphans');

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

// The object list is cached in lib/infra/orphans so the summary cards and the
// orphan index share one ~90-call listing instead of paying for it twice.
async function cachedBucketStats(prefix, { force = false } = {}) {
  const stats = await bucketStats(() => orphans.getBucketObjects({ force }), prefix);
  return { ...stats, cachedAt: orphans.bucketCachedAt() };
}

/**
 * `legacy_rows` (the pre-S3 minio: scheme) is kept in the payload but the UI
 * only renders it when non-zero — dropping it from the query entirely would
 * silently fold those rows into local_rows and misreport them as unuploaded.
 */
async function dbPathCounts() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE pdf_path LIKE 's3:%') AS s3_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 'minio:%') AS legacy_rows,
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
  return rows[0] || { s3_rows: 0, legacy_rows: 0, https_rows: 0, local_rows: 0, total: 0 };
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

// ── Orphans ─────────────────────────────────────────────────────────────────

// GET /api/admin/storage/orphans
//   ?source=all|s3|disk|s3-only  &match=all|matched|unmatched  &q=  &limit=  &offset=  &refresh=1
router.get('/orphans', async (req, res) => {
  try {
    const data = await orphans.listOrphans({
      source: req.query.source || 'all',
      match: req.query.match || 'all',
      q: req.query.q || '',
      limit: req.query.limit,
      offset: req.query.offset,
      force: req.query.refresh === '1',
    });
    res.json(data);
  } catch (err) {
    console.error('[storage] orphan list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/storage/orphans/adopt
// { keys: string[], companyId?: number, allowUnanalyzed?: boolean }
//
// Synchronous and capped — bulk adoption belongs on the background job so the
// request cannot sit open for thousands of uploads.
router.post('/orphans/adopt', express.json(), async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  if (keys.length === 0) return res.status(400).json({ error: 'keys[] required' });
  if (keys.length > 200) {
    return res.status(400).json({ error: 'Adopt at most 200 at a time — use "Adopt all matched" for bulk' });
  }

  try {
    const companyId = req.body?.companyId ? Number(req.body.companyId) : null;
    const allowUnanalyzed = req.body?.allowUnanalyzed === true;
    const targets = await orphans.findByKeys(keys);

    const result = { adopted: 0, skipped: 0, failures: [] };
    for (const orphan of targets) {
      const out = await orphans.adoptOrphan(orphan, { companyId, allowUnanalyzed });
      if (out.adopted) result.adopted++;
      else {
        result.skipped++;
        if (result.failures.length < 25) {
          result.failures.push({ key: orphan.key, reason: out.reason, error: out.error });
        }
      }
    }
    orphans.invalidate();
    res.json(result);
  } catch (err) {
    console.error('[storage] orphan adopt failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/storage/orphans/delete
// { keys: string[], scope?: 's3'|'disk'|'both' }
//
// Orphan-only by construction: every key is re-checked against filings inside
// deleteOrphans(), so a key that gained a row since the page loaded is skipped.
router.post('/orphans/delete', express.json(), async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  if (keys.length === 0) return res.status(400).json({ error: 'keys[] required' });
  if (keys.length > 1000) {
    return res.status(400).json({ error: 'Delete at most 1000 at a time — use "Delete all" for bulk' });
  }

  try {
    const scope = ['s3', 'disk', 'both'].includes(req.body?.scope) ? req.body.scope : 'both';
    const result = await orphans.deleteOrphans(keys, { scope });
    res.json(result);
  } catch (err) {
    console.error('[storage] orphan delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Migration / disk reclaim ────────────────────────────────────────────────

// GET /api/admin/storage/migration/status — poll while a job runs
router.get('/migration/status', (_req, res) => {
  res.json(migrationStatus());
});

// POST /api/admin/storage/migration/start
// { mode: 'upload'|'prune'|'adopt'|'purge', dryRun?, includeOrphans?,
//   scope?: 's3'|'disk'|'both', onlyMatched?, allowUnanalyzed? }
const JOB_MODES = ['upload', 'prune', 'adopt', 'purge'];

router.post('/migration/start', express.json(), (req, res) => {
  const mode = JOB_MODES.includes(req.body?.mode) ? req.body.mode : 'prune';

  const result = startMigration({
    mode,
    dryRun: req.body?.dryRun === true,
    includeOrphans: req.body?.includeOrphans === true,
    scope: req.body?.scope,
    onlyMatched: req.body?.onlyMatched !== false,
    // Defaults to 'unmatched' so an omitted field can never mean "delete every
    // orphan, including the adoptable ones".
    purgeTarget: req.body?.purgeTarget,
    allowUnanalyzed: req.body?.allowUnanalyzed === true,
  });

  if (!result.started) {
    const messages = {
      already_running: 'A storage job is already running',
      storage_disabled: 'AWS S3 is not configured (set AWS_S3_ENABLED=true)',
      invalid_mode: `mode must be one of ${JOB_MODES.join(', ')}`,
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
