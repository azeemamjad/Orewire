const express = require('express');
const router = express.Router();
const { pool } = require('./pool');
const { createViewToken } = require('./tokens');
const { STATUS } = require('./constants');
const { getProxyInventory, getPoolCounts } = require('./proxies');
const { assertValidWorkerId } = require('./security');
const {
  listBrowserTasks,
  listRecentTaskEvents,
  logTaskEvent,
  getBrowserTask,
} = require('./task-registry');

function baseUrl(req) {
  if (process.env.RELAY_BASE_URL) return process.env.RELAY_BASE_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function workerIdMiddleware(req, res, next) {
  try {
    req.relayWorkerId = assertValidWorkerId(req.params.id);
    next();
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid worker id' });
  }
}

// GET /api/relay/health
router.get('/health', (_req, res) => {
  const workers = pool.listWorkers();
  res.json({
    ok: true,
    enabled: process.env.RELAY_ENABLED === 'true',
    running: workers.length,
    pool: getPoolCounts(),
    starting: pool.isStarting(),
  });
});

// GET /api/relay/workers
router.get('/workers', (_req, res) => {
  res.json({ ok: true, workers: pool.listWorkers(), pool: getPoolCounts() });
});

// GET /api/relay/proxies
router.get('/proxies', (_req, res) => {
  res.json({ ok: true, inventory: getProxyInventory() });
});

// GET /api/relay/tasks — browser-required process catalog
router.get('/tasks', async (_req, res) => {
  try {
    const tasks = await listBrowserTasks();
    const browserTasks = tasks.filter((t) => t.needs_browser);
    const captchaTasks = tasks.filter((t) => t.needs_captcha);
    res.json({
      ok: true,
      tasks,
      summary: {
        total: tasks.length,
        needsBrowser: browserTasks.length,
        needsCaptcha: captchaTasks.length,
        noBrowser: tasks.filter((t) => !t.needs_browser).length,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/relay/tasks/events
router.get('/tasks/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const events = await listRecentTaskEvents(limit);
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/relay/tasks/:slug/event — log captcha / human / run status
router.post('/tasks/:slug/event', async (req, res) => {
  const task = await getBrowserTask(req.params.slug);
  if (!task) return res.status(404).json({ ok: false, error: 'Unknown task slug' });
  const { workerId, status, message, companyTicker } = req.body || {};
  if (!status) return res.status(400).json({ ok: false, error: 'status required' });
  try {
    if (workerId) assertValidWorkerId(workerId);
    await logTaskEvent({
      taskSlug: req.params.slug,
      workerId: workerId || null,
      status,
      message,
      companyTicker,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/relay/pool/start
router.post('/pool/start', async (_req, res) => {
  try {
    const workers = await pool.startPool();
    res.json({ ok: true, workers, pool: getPoolCounts(), inventory: getProxyInventory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/demo/start', async (_req, res) => {
  try {
    const workers = await pool.startPool();
    res.json({ ok: true, workers, pool: getPoolCounts(), inventory: getProxyInventory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/demo/stop', async (_req, res) => {
  try {
    await pool.shutdown();
    res.json({ ok: true, workers: [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/workers/:id/view', workerIdMiddleware, (req, res) => {
  const worker = pool.getWorker(req.relayWorkerId);
  if (!worker) {
    return res.status(404).json({ ok: false, error: 'Worker not found' });
  }
  const { token, expiresAt } = createViewToken(worker.id);
  const url = `${baseUrl(req)}/relay/view/${encodeURIComponent(token)}`;
  res.json({
    ok: true,
    url,
    expiresAt,
    workerId: worker.id,
    label: worker.label,
  });
});

router.post('/workers/:id/reset', workerIdMiddleware, async (req, res) => {
  try {
    const w = await pool.resetPage(req.relayWorkerId);
    res.json({
      ok: true,
      url: w.url,
      worker: pool.listWorkers().find((x) => x.id === req.relayWorkerId),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/workers/:id/status', workerIdMiddleware, (req, res) => {
  const { status } = req.body || {};
  if (!Object.values(STATUS).includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }
  try {
    pool.setStatus(req.relayWorkerId, status);
    res.json({
      ok: true,
      worker: pool.listWorkers().find((w) => w.id === req.relayWorkerId),
    });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

module.exports = router;
