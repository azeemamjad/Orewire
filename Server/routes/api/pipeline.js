const express = require('express');
const router = express.Router();

const { state, addLog } = require('../../pipeline/state');
const { load: loadConfig, save: saveConfig } = require('../../pipeline/config');
const { describeSchedule } = require('../../pipeline/cron-utils');
const { runPipeline, runAsxPipeline } = require('../../pipeline/runner');
const { runProfileScrape, isRunning: profilesRunning } = require('../../scripts/scrape-profiles');
const { runTransferAgentScrape, isRunning: taRunning, stopTransferAgentScrape } = require('../../scripts/scrape-transfer-agents');
const { getJob } = require('../../lib/job-tracker');
const { filterLogs, getLogSourcesPayload } = require('../../lib/log-sources');
const { applyConfig, bootstrapSchedulers, runAllSeeders, runNewsPipeline } = require('../../lib/pipeline-schedulers');
const { isNewsPipelineRunning } = require('../../lib/news-pipeline');

// Schedulers start after initPipelineConfig() in index.js

// GET /api/pipeline/status
router.get('/status', (req, res) => {
  const cfg = loadConfig();
  res.json({
    status: state.status,
    currentPhase: state.currentPhase,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    progress: state.progress,
    analysisProgress: state.analysisProgress,
    cronEnabled: cfg.enabled,
    cronAsxEnabled: cfg.asxEnabled,
    schedule: cfg.schedule,
    asxSchedule: cfg.asxSchedule,
    newsEnabled: cfg.newsEnabled,
    newsSchedule: cfg.newsSchedule,
    profilesEnabled: cfg.profilesEnabled,
    profilesSchedule: cfg.profilesSchedule,
    seederEnabled: cfg.seederEnabled,
    seederSchedule: cfg.seederSchedule,
    scheduleDescription: describeSchedule(cfg.mainScheduleParts),
    asxScheduleDescription: describeSchedule(cfg.asxScheduleParts),
    newsScheduleDescription: describeSchedule(cfg.newsScheduleParts),
    profilesScheduleDescription: describeSchedule(cfg.profilesScheduleParts),
    seederScheduleDescription: describeSchedule(cfg.seederScheduleParts),
    newsRunning: isNewsPipelineRunning(),
    logCount: state.logs.length,
  });
});

router.post('/start', (req, res) => {
  if (state.status === 'running') {
    return res.status(409).json({ error: 'Pipeline already running' });
  }
  runPipeline();
  res.json({ ok: true, message: 'Pipeline started' });
});

router.post('/asx/start', (req, res) => {
  if (state.status === 'running') {
    return res.status(409).json({ error: 'Pipeline already running' });
  }
  runAsxPipeline();
  res.json({ ok: true, message: 'ASX pipeline started' });
});

router.post('/news/start', (req, res) => {
  if (isNewsPipelineRunning()) {
    return res.status(409).json({ error: 'News pipeline already running' });
  }
  runNewsPipeline();
  res.json({ ok: true, message: 'News pipeline started' });
});

router.post('/seeders/start', (req, res) => {
  runAllSeeders();
  res.json({ ok: true, message: 'Seeders started' });
});

router.post('/profiles/start', express.json(), (req, res) => {
  if (profilesRunning()) {
    return res.status(409).json({ error: 'Profile scrape already running' });
  }
  const opts = {
    limit: req.body?.limit ?? null,
    ticker: req.body?.ticker || null,
    refreshDays: req.body?.refreshDays ?? null,
    delay: req.body?.delay ?? 2500,
    dryRun: !!req.body?.dryRun,
  };
  runProfileScrape(opts).catch((err) => addLog('err', `[Profiles] Fatal: ${err.message}`));
  res.json({ ok: true, message: 'Profile scrape started', opts });
});

router.get('/profiles/status', (_req, res) => {
  res.json({ running: profilesRunning() });
});

router.post('/transfer-agents/start', express.json(), (req, res) => {
  if (taRunning()) {
    return res.status(409).json({
      error: 'Transfer-agent scrape already running',
      running: true,
      job: getJob('transfer-agents'),
    });
  }
  const opts = {
    limit: req.body?.limit ?? null,
    ticker: req.body?.ticker || null,
    all: !!req.body?.all,
    dryRun: !!req.body?.dryRun,
  };
  runTransferAgentScrape(opts).catch((err) => addLog('err', `[TA] Fatal: ${err.message}`));
  res.json({ ok: true, message: 'Transfer-agent scrape started', opts });
});

router.get('/transfer-agents/status', (_req, res) => {
  res.json({ running: taRunning(), job: getJob('transfer-agents') });
});

router.post('/transfer-agents/stop', (_req, res) => {
  if (!taRunning()) {
    return res.status(409).json({ error: 'Transfer-agent scrape is not running' });
  }
  stopTransferAgentScrape();
  res.json({ ok: true, message: 'Stop signal sent' });
});

router.post('/stop', (req, res) => {
  if (state.status !== 'running') {
    return res.status(409).json({ error: 'Pipeline is not running' });
  }
  state.stopRequested = true;
  addLog('warn', '[Pipeline] Stop requested by user');
  res.json({ ok: true, message: 'Stop signal sent — finishing current workers' });
});

router.get('/log-sources', (_req, res) => {
  res.json(getLogSourcesPayload(state.logs));
});

router.get('/logs', (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const source = (req.query.source || 'all').toString();
  const filtered = filterLogs(state.logs, source);
  res.json({
    logs: filtered.slice(offset),
    total: filtered.length,
    source,
  });
});

router.get('/config', (req, res) => {
  res.json({ ...loadConfig(), storage: 'database' });
});

router.post('/config', express.json(), async (req, res) => {
  const body = req.body || {};
  const updates = {};

  const num = (v, min, max) => Math.max(min, Math.min(max, parseInt(v, 10)));

  if (body.schedule !== undefined) updates.schedule = body.schedule;
  if (body.mainScheduleParts !== undefined) updates.mainScheduleParts = body.mainScheduleParts;
  if (body.concurrency !== undefined) updates.concurrency = num(body.concurrency, 1, 20);
  if (body.analysisConcurrency !== undefined) updates.analysisConcurrency = num(body.analysisConcurrency, 1, 10);
  if (body.daysBack !== undefined) updates.daysBack = Math.max(1, parseInt(body.daysBack, 10));
  if (body.seedOnStart !== undefined) updates.seedOnStart = Boolean(body.seedOnStart);
  if (body.asxSeedOnStart !== undefined) updates.asxSeedOnStart = Boolean(body.asxSeedOnStart);
  if (body.analyze !== undefined) updates.analyze = Boolean(body.analyze);
  if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);

  if (body.asxSchedule !== undefined) updates.asxSchedule = body.asxSchedule;
  if (body.asxScheduleParts !== undefined) updates.asxScheduleParts = body.asxScheduleParts;
  if (body.asxEnabled !== undefined) updates.asxEnabled = Boolean(body.asxEnabled);
  if (body.asxSeedOnStart !== undefined) updates.asxSeedOnStart = Boolean(body.asxSeedOnStart);
  if (body.asxAnalyze !== undefined) updates.asxAnalyze = Boolean(body.asxAnalyze);
  if (body.asxConcurrency !== undefined) updates.asxConcurrency = num(body.asxConcurrency, 1, 20);
  if (body.asxAnalysisConcurrency !== undefined) updates.asxAnalysisConcurrency = num(body.asxAnalysisConcurrency, 1, 10);
  if (body.asxDaysBack !== undefined) updates.asxDaysBack = Math.max(1, parseInt(body.asxDaysBack, 10));

  if (body.newsScheduleParts !== undefined) updates.newsScheduleParts = body.newsScheduleParts;
  if (body.newsEnabled !== undefined) updates.newsEnabled = Boolean(body.newsEnabled);
  if (body.profilesScheduleParts !== undefined) updates.profilesScheduleParts = body.profilesScheduleParts;
  if (body.profilesEnabled !== undefined) updates.profilesEnabled = Boolean(body.profilesEnabled);
  if (body.profilesDelay !== undefined) updates.profilesDelay = Math.max(0, parseInt(body.profilesDelay, 10));
  if (body.seederScheduleParts !== undefined) updates.seederScheduleParts = body.seederScheduleParts;
  if (body.seederEnabled !== undefined) updates.seederEnabled = Boolean(body.seederEnabled);

  try {
    const cfg = await saveConfig(updates);
    applyConfig(cfg);
    addLog('out', `[Pipeline] Config saved to database: ${JSON.stringify(updates)}`);
    res.json({ ...cfg, storage: 'database' });
  } catch (err) {
    console.error('[Pipeline] Config save failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to save config' });
  }
});

module.exports = router;
