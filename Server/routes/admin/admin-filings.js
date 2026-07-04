const express = require('express');
const {
  listPendingOnDisk,
  processPendingOnDisk,
} = require('../../lib/filings/process-pending-disk');

const router = express.Router();

let activeJob = null;

function serializeJob(job) {
  if (!job) return { status: 'idle' };
  return {
    id: job.id,
    status: job.status,
    limit: job.limit,
    phase: job.phase,
    total: job.total,
    processed: job.processed,
    ok: job.ok,
    extractionFailed: job.extractionFailed,
    errors: job.errors,
    currentId: job.currentId,
    currentFile: job.currentFile,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    results: (job.results || []).slice(-50),
  };
}

// GET /api/admin/filings/pending-on-disk
router.get('/pending-on-disk', async (_req, res) => {
  try {
    const data = await listPendingOnDisk({ limit: 2000 });
    res.json({
      downloadsDir: data.downloadsDir,
      pendingInDb: data.pendingInDb,
      onDisk: data.onDisk,
      samples: data.items.slice(0, 20).map((i) => ({
        id: i.id,
        companyName: i.companyName,
        pdfFilename: i.pdfFilename,
        status: i.status,
        localPath: i.localPath,
      })),
      job: serializeJob(activeJob),
    });
  } catch (err) {
    console.error('[admin-filings] pending-on-disk failed:', err);
    res.status(500).json({ error: err.message || 'Failed to list pending filings' });
  }
});

// GET /api/admin/filings/process-pending/status
router.get('/process-pending/status', (_req, res) => {
  res.json(serializeJob(activeJob));
});

// POST /api/admin/filings/process-pending
// Body: { limit?: number }  default 25, max 100
router.post('/process-pending', express.json(), async (req, res) => {
  if (activeJob?.status === 'running') {
    return res.status(409).json({ error: 'A process job is already running', job: serializeJob(activeJob) });
  }

  const limit = Math.max(1, Math.min(100, parseInt(req.body?.limit, 10) || 25));
  const job = {
    id: Date.now().toString(),
    status: 'running',
    limit,
    phase: 'start',
    total: 0,
    processed: 0,
    ok: 0,
    extractionFailed: 0,
    errors: 0,
    currentId: null,
    currentFile: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    results: [],
  };
  activeJob = job;

  res.json({ ok: true, jobId: job.id, job: serializeJob(job) });

  (async () => {
    try {
      const stats = await processPendingOnDisk({
        limit,
        onProgress: (p) => {
          job.phase = p.phase || job.phase;
          job.total = p.total ?? job.total;
          job.processed = p.processed ?? job.processed;
          job.ok = p.ok ?? job.ok;
          job.extractionFailed = p.extractionFailed ?? job.extractionFailed;
          job.errors = p.errors ?? job.errors;
          job.currentId = p.currentId ?? job.currentId;
          job.currentFile = p.currentFile ?? job.currentFile;
          if (Array.isArray(p.results)) job.results = p.results;
        },
      });
      job.status = 'done';
      job.total = stats.total;
      job.processed = stats.processed;
      job.ok = stats.ok;
      job.extractionFailed = stats.extractionFailed;
      job.errors = stats.errors;
      job.results = stats.results;
      job.finishedAt = new Date().toISOString();
    } catch (err) {
      job.status = 'error';
      job.error = err.message || String(err);
      job.finishedAt = new Date().toISOString();
    }
  })();
});

module.exports = router;
