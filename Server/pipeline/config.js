const fs = require('fs');
const path = require('path');
const { buildCron, parseCron } = require('./cron-utils');
const { getSetting, setSetting } = require('../db/app-settings');

const PIPELINE_KEY = 'pipeline';
const CONFIG_PATH = path.join(__dirname, '../data/pipeline.json');

const DEFAULTS = {
  schedule: '0 6 * * *',
  mainScheduleParts: { frequency: 'daily', hour: 6, minute: 0, hours: 3, dayOfWeek: 1 },
  concurrency: 5,
  analysisConcurrency: 2,
  daysBack: 30,
  seedOnStart: true,
  asxSeedOnStart: true,
  analyze: true,
  enabled: false,
  asxSchedule: '0 7 * * *',
  asxScheduleParts: { frequency: 'daily', hour: 7, minute: 0, hours: 3, dayOfWeek: 1 },
  asxEnabled: false,
  asxSeedOnStart: true,
  asxAnalyze: true,
  asxConcurrency: null,
  asxAnalysisConcurrency: null,
  asxDaysBack: null,
  newsSchedule: '0 */3 * * *',
  newsScheduleParts: { frequency: 'every_hours', hour: 0, minute: 0, hours: 3, dayOfWeek: 1 },
  newsEnabled: true,
  profilesSchedule: '0 2 * * *',
  profilesScheduleParts: { frequency: 'daily', hour: 2, minute: 0, hours: 3, dayOfWeek: 1 },
  profilesEnabled: true,
  profilesDelay: 2500,
  seederSchedule: '0 1 * * *',
  seederScheduleParts: { frequency: 'daily', hour: 1, minute: 0, hours: 3, dayOfWeek: 1 },
  seederEnabled: true,
};

let cache = null;
let initialized = false;

function hydrate(cfg) {
  const out = { ...DEFAULTS, ...cfg };
  if (!out.mainScheduleParts) out.mainScheduleParts = parseCron(out.schedule);
  if (!out.asxScheduleParts) out.asxScheduleParts = parseCron(out.asxSchedule);
  if (!out.newsScheduleParts) out.newsScheduleParts = parseCron(out.newsSchedule);
  if (!out.profilesScheduleParts) out.profilesScheduleParts = parseCron(out.profilesSchedule);
  if (!out.seederScheduleParts) out.seederScheduleParts = parseCron(out.seederSchedule);
  return out;
}

function loadFromFile() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return hydrate(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    }
  } catch {
    /* ignore */
  }
  return hydrate({});
}

/** Call once after DB migrate — loads pipeline config from app_settings (imports legacy JSON if needed). */
async function initPipelineConfig() {
  if (initialized && cache) return cache;

  let stored = await getSetting(PIPELINE_KEY);
  if (!stored) {
    const fromFile = loadFromFile();
    await setSetting(PIPELINE_KEY, fromFile);
    stored = fromFile;
    console.log('[Config] Seeded pipeline settings from defaults / pipeline.json → database');
  }

  cache = hydrate(stored);
  initialized = true;
  return cache;
}

/** Synchronous read — use after initPipelineConfig() at server startup. */
function load() {
  if (!cache) return hydrate({});
  return { ...cache };
}

async function save(updates) {
  if (!initialized) await initPipelineConfig();

  const current = load();
  const merged = { ...current, ...updates };

  if (updates.mainScheduleParts) merged.schedule = buildCron(updates.mainScheduleParts);
  if (updates.asxScheduleParts) merged.asxSchedule = buildCron(updates.asxScheduleParts);
  if (updates.newsScheduleParts) merged.newsSchedule = buildCron(updates.newsScheduleParts);
  if (updates.profilesScheduleParts) merged.profilesSchedule = buildCron(updates.profilesScheduleParts);
  if (updates.seederScheduleParts) merged.seederSchedule = buildCron(updates.seederScheduleParts);

  const cfg = hydrate(merged);
  await setSetting(PIPELINE_KEY, cfg);
  cache = cfg;
  return cfg;
}

module.exports = { load, save, initPipelineConfig, DEFAULTS, hydrate, PIPELINE_KEY };
