const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/pipeline.json');

const DEFAULTS = {
  schedule:    '0 6 * * *',
  concurrency: 5,
  analysisConcurrency: 2,
  daysBack:    30,
  seedOnStart: true,
  asxSeedOnStart: false,   // Include ASX in main pipeline seeding
  analyze:     true,
  enabled:     false,
  asxSchedule: '0 7 * * *',
  asxEnabled:  false,
};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch { /* fall back to defaults */ }
  return { ...DEFAULTS };
}

function save(updates) {
  const current = load();
  const cfg = { ...current, ...updates };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

module.exports = { load, save, DEFAULTS };
