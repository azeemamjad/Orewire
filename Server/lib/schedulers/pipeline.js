const cron = require('node-cron');
const http = require('http');
const { load: loadConfig } = require('../../pipeline/config');
const { addLog } = require('../../pipeline/state');
const { runNewsPipeline } = require('../news/pipeline');
const { runProfileScrape } = require('../../jobs/scrape-profiles');
const { shouldSkipDay, describeSkipDays } = require('./skip-days');

let mainCronTask = null;
let asxCronTask = null;
let newsCronTask = null;
let profilesCronTask = null;
let seederCronTask = null;

function httpPost(path) {
  return new Promise((resolve) => {
    const port = process.env.PORT || 3000;
    const body = '{}';
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve({ raw: buf.substring(0, 200) });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.write(body);
    req.end();
  });
}

async function runAllSeeders() {
  addLog('out', '[Seeder Cron] Running TSX/TSXV, CSE, and ASX seeders…');
  for (const [label, endpoint] of [
    ['TSX/TSXV', '/api/seeder/tsx'],
    ['CSE', '/api/seeder/cse'],
    ['ASX', '/api/seeder/asx'],
  ]) {
    const result = await httpPost(endpoint);
    if (result.error) {
      addLog('err', `[Seeder Cron] ${label}: ${result.error}`);
    } else {
      addLog('out', `[Seeder Cron] ${label}: inserted=${result.inserted ?? '?'}, skipped=${result.skipped ?? '?'}`);
    }
  }
}

function setupCron(getTask, setTask, schedule, enabled, handler, label, opts = {}) {
  const existing = getTask();
  if (existing) {
    existing.stop();
    setTask(null);
  }
  if (!schedule || !cron.validate(schedule)) {
    addLog('warn', `[Scheduler] Invalid cron for ${label}: "${schedule}"`);
    return;
  }

  const skipDays = opts.skipDays || [];

  const task = cron.schedule(
    schedule,
    () => {
      // Paused-day gate: the cron still fires, but the job does not start.
      const gate = shouldSkipDay(skipDays);
      if (gate.skip) {
        addLog('out', `[Scheduler] ${label} skipped — ${gate.dayName} is a paused day`);
        return;
      }
      addLog('out', `[Scheduler] ${label} fired at ${new Date().toISOString()}`);
      Promise.resolve(handler()).catch((err) => addLog('err', `[Scheduler] ${label}: ${err.message}`));
    },
    { scheduled: false }
  );

  if (enabled) task.start();
  setTask(task);
}

function applyConfig(cfg) {
  const { runPipeline, runAsxPipeline } = require('../../pipeline/runner');
  const gate = { skipDays: cfg.skipDays || [] };

  setupCron(() => mainCronTask, (t) => { mainCronTask = t; }, cfg.schedule, cfg.enabled, runPipeline, 'Canada pipeline', gate);
  setupCron(() => asxCronTask, (t) => { asxCronTask = t; }, cfg.asxSchedule, cfg.asxEnabled, runAsxPipeline, 'ASX pipeline', gate);
  setupCron(() => newsCronTask, (t) => { newsCronTask = t; }, cfg.newsSchedule, cfg.newsEnabled, runNewsPipeline, 'News pipeline', gate);
  setupCron(
    () => profilesCronTask,
    (t) => { profilesCronTask = t; },
    cfg.profilesSchedule,
    cfg.profilesEnabled,
    () => runProfileScrape({ delay: cfg.profilesDelay || 2500 }).catch((err) => addLog('err', `[Profiles] ${err.message}`)),
    'Profile scrape',
    gate
  );
  setupCron(() => seederCronTask, (t) => { seederCronTask = t; }, cfg.seederSchedule, cfg.seederEnabled, runAllSeeders, 'Company seeders', gate);
}

function bootstrapSchedulers(cfg) {
  const config = cfg || loadConfig();
  applyConfig(config);
  addLog(
    'out',
    `[Scheduler] Bootstrapped from database — main: ${config.enabled}, ASX: ${config.asxEnabled}, news: ${config.newsEnabled}, profiles: ${config.profilesEnabled}, seeders: ${config.seederEnabled}`
  );
  addLog('out', `[Scheduler] Paused days: ${describeSkipDays(config.skipDays)}`);
  return config;
}

module.exports = {
  applyConfig,
  bootstrapSchedulers,
  runAllSeeders,
  runNewsPipeline,
};
