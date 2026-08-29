/**
 * Engine registry — one place that decides *what browser* a relay worker runs.
 *
 *   RELAY_ENGINE=chrome    (default) real Google Chrome via patchright
 *   RELAY_ENGINE=camoufox  patched Firefox, for when Chromium keeps losing
 *
 * Both return the same session shape, so pool.js and the viewer never branch on
 * the engine — only on `supportsCdp`.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const chromeEngine = require('./chromium');
const { driverName, isPatched } = require('./driver');

const ENGINES = {
  chrome: chromeEngine,
  chromium: chromeEngine,
  camoufox: () => require('./camoufox'),
};

// Real desktop window sizes. Varying this per worker matters: a pool where every
// browser reports an identical viewport is one fingerprint wearing five IPs.
const WINDOWS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

function randomWindow() {
  return WINDOWS[Math.floor(Math.random() * WINDOWS.length)];
}

function resolveEngineId() {
  const id = (process.env.RELAY_ENGINE || 'chrome').trim().toLowerCase();
  if (!ENGINES[id]) {
    console.warn(`[Relay] Unknown RELAY_ENGINE="${id}" — falling back to chrome`);
    return 'chrome';
  }
  return id;
}

function getEngine(id = resolveEngineId()) {
  const entry = ENGINES[id];
  return typeof entry === 'function' && !entry.launch ? entry() : entry;
}

/**
 * Where a worker's persistent profile lives. Keyed by worker id so a given proxy
 * slot keeps its cookies, storage and prefs across restarts — a browser whose
 * profile is empty on every visit looks nothing like a returning human.
 */
function profileDirFor(workerId, engineId = resolveEngineId()) {
  const base = process.env.RELAY_PROFILE_DIR
    || path.join(__dirname, '../../data/profiles');
  return path.join(base, engineId, String(workerId).replace(/[^\w.-]/g, '_'));
}

/** Delete a worker's profile — used when a session is burned (hard block). */
function resetProfile(workerId, engineId = resolveEngineId()) {
  const dir = profileDirFor(workerId, engineId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.workerId
 * @param {object|null} opts.proxy
 * @param {boolean} opts.headless
 */
async function launchSession({ workerId, proxy, headless }) {
  const engineId = resolveEngineId();
  const engine = getEngine(engineId);
  const profileDir = profileDirFor(workerId, engineId);
  const window = randomWindow();

  const session = await engine.launch({ profileDir, proxy, window, headless });
  return { ...session, engineId, workerId };
}

/** One-line summary for logs / the admin panel. */
function describeEngine() {
  const engineId = resolveEngineId();
  return {
    engine: engineId,
    driver: driverName(),
    patched: isPatched(),
    chromeChannel: engineId === 'camoufox' ? null : chromeEngine.resolveChannel(),
    platform: `${os.platform()}/${os.arch()}`,
  };
}

module.exports = {
  launchSession,
  resolveEngineId,
  profileDirFor,
  resetProfile,
  describeEngine,
  randomWindow,
  WINDOWS,
};
