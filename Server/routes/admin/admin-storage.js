const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const minio = require('../../lib/infra/minio-storage');
const aws = require('../../lib/infra/aws-s3-storage');
const {
  getFilingPrefix,
  usePresignedUrls,
  presignExpiresSec,
  isStorageEnabled,
  isMinioEnabled,
} = require('../../lib/infra/object-storage');
const { runMigration } = require('../../lib/infra/migrate-minio-to-s3');

const router = express.Router();

const CHECKPOINT_PATH = path.join(__dirname, '../../data/storage-migration.json');
const MAX_LOGS = 500;

let activeJob = null;

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

function saveCheckpoint(job) {
  try {
    const dir = path.dirname(CHECKPOINT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(job, null, 2));
  } catch (err) {
    console.error('[storage] checkpoint write failed:', err.message);
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);
  } catch { /* ignore */ }
}

function appendLog(job, message, level = 'info') {
  job.logs.push({ t: new Date().toISOString(), level, message });
  if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
}

async function bucketStats(listFn, prefix = '') {
  const objects = await listFn(prefix);
  const bytes = objects.reduce((s, o) => s + (o.size || 0), 0);
  const pdfs = objects.filter((o) => (o.name || '').toLowerCase().endsWith('.pdf'));
  return { objects: objects.length, pdfObjects: pdfs.length, bytes };
}

async function dbPathCounts() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE pdf_path LIKE 'minio:%') AS minio_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 's3:%') AS s3_rows,
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
    minio_rows: 0, s3_rows: 0, https_rows: 0, local_rows: 0, total: 0,
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
router.get('/summary', async (_req, res) => {
  try {
    const dbCounts = await dbPathCounts();
    const prefix = `${getFilingPrefix()}/`;

    const minioConn = await testConnection(isMinioEnabled(), () => minio.ensureBucket());
    const s3Conn = await testConnection(isStorageEnabled(), () => aws.ensureBucket());

    let minioStats = null;
    if (minioConn.ok) {
      try {
        minioStats = await bucketStats((p) => minio.listObjects(p), prefix);
      } catch (err) {
        minioStats = { error: err.message };
      }
    }

    let s3Stats = null;
    if (s3Conn.ok) {
      try {
        s3Stats = await bucketStats((p) => aws.listObjects(p), prefix);
      } catch (err) {
        s3Stats = { error: err.message };
      }
    }

    const checkpoint = loadCheckpoint();
    const jobRunning = activeJob?.status === 'running';

    res.json({
      config: {
        filingPrefix: getFilingPrefix(),
        presignedUrls: usePresignedUrls(),
        presignExpiresSec: presignExpiresSec(),
        minioBucket: isMinioEnabled() ? minio.getBucket() : null,
        s3Bucket: isStorageEnabled() ? aws.getBucket() : null,
        s3Region: isStorageEnabled() ? aws.getRegion() : null,
      },
      connections: { minio: minioConn, s3: s3Conn },
      db: dbCounts,
      minio: minioStats,
      s3: s3Stats,
      migration: {
        running: jobRunning,
        lastJob: checkpoint || (activeJob ? serializeJob(activeJob) : null),
      },
    });
  } catch (err) {
    console.error('[storage] summary failed:', err);
    res.status(500).json({ error: err.message });
  }
});

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    includeLocal: job.includeLocal,
    includeOrphans: job.includeOrphans,
    phase: job.phase,
    processed: job.processed,
    total: job.total,
    stats: job.stats,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    logs: job.logs.slice(-100),
  };
}

// POST /api/admin/storage/migrate
router.post('/migrate', express.json(), async (req, res) => {
  if (activeJob?.status === 'running') {
    return res.status(409).json({ error: 'Migration already running' });
  }

  const dryRun = !!req.body?.dryRun;
  const includeLocal = !!req.body?.includeLocal;
  const includeOrphans = !!req.body?.includeOrphans;

  const job = {
    id: Date.now().toString(),
    status: 'running',
    dryRun,
    includeLocal,
    includeOrphans,
    phase: 'init',
    processed: 0,
    total: 0,
    stats: null,
    cancelRequested: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    logs: [],
  };

  activeJob = job;
  appendLog(job, dryRun ? 'Dry run started' : 'Migration started');
  saveCheckpoint(serializeJob(job));

  res.json({ ok: true, jobId: job.id });

  (async () => {
    try {
      const { stats } = await runMigration({
        dryRun,
        includeLocal,
        includeOrphans,
        shouldCancel: () => job.cancelRequested,
      }, (progress) => {
        if (progress.phase) job.phase = progress.phase;
        if (typeof progress.processed === 'number') job.processed = progress.processed;
        if (typeof progress.total === 'number') job.total = progress.total;
        if (progress.stats) job.stats = progress.stats;
        if (progress.message) appendLog(job, progress.message, progress.level || 'info');
        saveCheckpoint(serializeJob(job));
      });

      job.stats = stats;
      job.status = job.cancelRequested ? 'cancelled' : 'done';
      job.finishedAt = new Date().toISOString();
      appendLog(job, job.status === 'cancelled' ? 'Migration cancelled' : 'Migration complete');
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.finishedAt = new Date().toISOString();
      appendLog(job, err.message, 'error');
    } finally {
      saveCheckpoint(serializeJob(job));
    }
  })();
});

// GET /api/admin/storage/migrate/status
router.get('/migrate/status', (_req, res) => {
  if (activeJob) {
    return res.json(serializeJob(activeJob));
  }
  const checkpoint = loadCheckpoint();
  if (checkpoint) return res.json(checkpoint);
  res.json({ status: 'idle' });
});

// POST /api/admin/storage/migrate/cancel
router.post('/migrate/cancel', (_req, res) => {
  if (!activeJob || activeJob.status !== 'running') {
    return res.status(400).json({ error: 'No migration running' });
  }
  activeJob.cancelRequested = true;
  appendLog(activeJob, 'Cancel requested…');
  res.json({ ok: true });
});

module.exports = router;
