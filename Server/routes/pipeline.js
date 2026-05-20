const express = require('express');
const router  = express.Router();
const cron    = require('node-cron');

const { state, addLog }           = require('../pipeline/state');
const { load: loadConfig, save: saveConfig } = require('../pipeline/config');
const { runPipeline, runAsxPipeline } = require('../pipeline/runner');

let mainCronTask = null;
let asxCronTask  = null;

// ---------------------------------------------------------------------------
// Cron management
// ---------------------------------------------------------------------------

function setupMainCron(schedule, enabled) {
  if (mainCronTask) { mainCronTask.stop(); mainCronTask = null; }
  if (!schedule || !cron.validate(schedule)) return;

  mainCronTask = cron.schedule(schedule, () => {
    addLog('out', `[Pipeline] Main cron fired at ${new Date().toISOString()}`);
    runPipeline();
  }, { scheduled: false });

  if (enabled) mainCronTask.start();
}

function setupAsxCron(schedule, enabled) {
  if (asxCronTask) { asxCronTask.stop(); asxCronTask = null; }
  if (!schedule || !cron.validate(schedule)) return;

  asxCronTask = cron.schedule(schedule, () => {
    addLog('out', `[ASX Pipeline] Cron fired at ${new Date().toISOString()}`);
    runAsxPipeline();
  }, { scheduled: false });

  if (enabled) asxCronTask.start();
}

// Bootstrap on startup
const _initCfg = loadConfig();
setupMainCron(_initCfg.schedule, _initCfg.enabled);
setupAsxCron(_initCfg.asxSchedule, _initCfg.asxEnabled);
addLog('out', `[Pipeline] Server started. Main schedule: "${_initCfg.schedule}", enabled: ${_initCfg.enabled} | ASX schedule: "${_initCfg.asxSchedule}", enabled: ${_initCfg.asxEnabled}`);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/pipeline/status
router.get('/status', (req, res) => {
  const cfg = loadConfig();
  res.json({
    status:       state.status,
    currentPhase: state.currentPhase,
    startedAt:    state.startedAt,
    stoppedAt:    state.stoppedAt,
    progress:     state.progress,
    analysisProgress: state.analysisProgress,
    cronEnabled:  cfg.enabled,
    cronAsxEnabled: cfg.asxEnabled,
    schedule:     cfg.schedule,
    asxSchedule:  cfg.asxSchedule,
    logCount:     state.logs.length,
  });
});

// POST /api/pipeline/start
router.post('/start', (req, res) => {
  if (state.status === 'running') {
    return res.status(409).json({ error: 'Pipeline already running' });
  }
  runPipeline();   // intentionally not awaited — runs in background
  res.json({ ok: true, message: 'Pipeline started' });
});

// POST /api/pipeline/asx/start
router.post('/asx/start', (req, res) => {
  if (state.status === 'running') {
    return res.status(409).json({ error: 'Pipeline already running' });
  }
  runAsxPipeline();   // ASX-only pipeline
  res.json({ ok: true, message: 'ASX pipeline started' });
});

// POST /api/pipeline/stop
router.post('/stop', (req, res) => {
  if (state.status !== 'running') {
    return res.status(409).json({ error: 'Pipeline is not running' });
  }
  state.stopRequested = true;
  addLog('warn', '[Pipeline] Stop requested by user');
  res.json({ ok: true, message: 'Stop signal sent — finishing current workers' });
});

// GET /api/pipeline/logs?offset=N
router.get('/logs', (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  res.json({
    logs:  state.logs.slice(offset),
    total: state.logs.length,
  });
});

// GET /api/pipeline/config
router.get('/config', (req, res) => {
  res.json(loadConfig());
});

// POST /api/pipeline/config
router.post('/config', express.json(), (req, res) => {
  const { schedule, concurrency, analysisConcurrency, daysBack, seedOnStart, asxSeedOnStart, analyze, enabled, asxSchedule, asxEnabled } = req.body;
  const updates = {};
  if (schedule    !== undefined) updates.schedule    = schedule;
  if (concurrency !== undefined) updates.concurrency = Math.max(1, Math.min(20, parseInt(concurrency)));
  if (analysisConcurrency !== undefined) updates.analysisConcurrency = Math.max(1, Math.min(10, parseInt(analysisConcurrency)));
  if (daysBack    !== undefined) updates.daysBack     = Math.max(1, parseInt(daysBack));
  if (seedOnStart !== undefined) updates.seedOnStart  = Boolean(seedOnStart);
  if (asxSeedOnStart !== undefined) updates.asxSeedOnStart = Boolean(asxSeedOnStart);
  if (analyze     !== undefined) updates.analyze      = Boolean(analyze);
  if (enabled     !== undefined) updates.enabled      = Boolean(enabled);
  if (asxSchedule !== undefined) updates.asxSchedule  = asxSchedule;
  if (asxEnabled  !== undefined) updates.asxEnabled   = Boolean(asxEnabled);

  const cfg = saveConfig(updates);
  setupMainCron(cfg.schedule, cfg.enabled);
  setupAsxCron(cfg.asxSchedule, cfg.asxEnabled);
  addLog('out', `[Pipeline] Config updated: ${JSON.stringify(updates)}`);
  res.json(cfg);
});

module.exports = router;
