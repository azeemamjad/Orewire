const express = require('express');
const router = express.Router();
const { getSystemSnapshot } = require('../lib/system-monitor');
const { syncAllJobs, endJob, isPidAlive } = require('../lib/job-tracker');

router.get('/processes', async (_req, res) => {
  try {
    const snapshot = await getSystemSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error('[System] Snapshot failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to read system stats' });
  }
});

router.post('/jobs/:id/stop', express.json(), (req, res) => {
  const id = req.params.id;
  try {
    if (id === 'transfer-agents') {
      const { stopTransferAgentScrape } = require('../scripts/scrape-transfer-agents');
      stopTransferAgentScrape();
      return res.json({ ok: true, message: 'Transfer-agent scrape stop signal sent' });
    }
    if (id === 'profiles') {
      endJob('profiles', 'stopped');
      return res.json({ ok: true, message: 'Profile job marked stopped (in-process jobs finish current company)' });
    }
    const job = require('../lib/job-tracker').getJob(id);
    if (job?.pid && isPidAlive(job.pid)) {
      try {
        process.kill(job.pid);
      } catch {
        /* ignore */
      }
    }
    endJob(id, 'stopped');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Stop failed' });
  }
});

router.post('/jobs/reset-stale', (_req, res) => {
  syncAllJobs();
  const stale = require('../lib/job-tracker').getAllJobs().filter((j) => j.status === 'stale');
  for (const j of stale) {
    require('../lib/job-tracker').endJob(j.id, 'cleared');
  }
  res.json({ ok: true, cleared: stale.length });
});

module.exports = router;
