const { serverRoot, DOWNLOADS_DIR } = require('./paths');

const RELAY_ENV_KEYS = ['OREWIRE_RELAY', 'OREWIRE_SERVER_PATH', 'HEADLESS', 'DOWNLOADS_DIR'];

function applyScraperEnv({ relay = false } = {}) {
  const saved = {};
  for (const k of RELAY_ENV_KEYS) saved[k] = process.env[k];

  process.env.DOWNLOADS_DIR = DOWNLOADS_DIR;
  if (relay) {
    Object.assign(process.env, {
      OREWIRE_RELAY: 'in-process',
      OREWIRE_SERVER_PATH: serverRoot(),
      HEADLESS: process.env.RELAY_HEADLESS !== 'false' ? 'true' : 'false',
    });
  } else if (saved.OREWIRE_RELAY === undefined) {
    delete process.env.OREWIRE_RELAY;
  }

  return saved;
}

function restoreScraperEnv(saved) {
  for (const k of RELAY_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function relayWiringEnabled() {
  return process.env.RELAY_ENABLED === 'true' && process.env.RELAY_WIRE_SCRAPERS !== 'false';
}

module.exports = { applyScraperEnv, restoreScraperEnv, relayWiringEnabled };
