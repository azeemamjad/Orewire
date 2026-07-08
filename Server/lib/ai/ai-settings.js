/**
 * Global AI runtime settings (Admin → AI pause switch).
 *
 * Persisted in the app_settings key-value table so a pause survives restarts.
 * A short in-memory cache keeps the hot path (every chat() call) off the DB.
 */
const db = require('../../db');

const PAUSE_KEY = 'ai_paused';
const CACHE_TTL_MS = 5000;

let _cache = { paused: false, loadedAt: 0 };

async function readPaused() {
  const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [PAUSE_KEY]);
  const value = r.rows[0]?.value;
  // value is JSONB — stored as { paused: true }
  return !!(value && value.paused);
}

/** Cached pause check for the chat() hot path. */
async function isAiPaused() {
  const now = Date.now();
  if (now - _cache.loadedAt < CACHE_TTL_MS) return _cache.paused;
  try {
    _cache = { paused: await readPaused(), loadedAt: now };
  } catch {
    // On a DB hiccup, fail open (do not block AI) but keep the stale value.
    _cache.loadedAt = now;
  }
  return _cache.paused;
}

/** Force a fresh read on next isAiPaused() call. */
function invalidatePauseCache() {
  _cache.loadedAt = 0;
}

async function setAiPaused(paused) {
  const next = !!paused;
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PAUSE_KEY, JSON.stringify({ paused: next })],
  );
  _cache = { paused: next, loadedAt: Date.now() };
  return next;
}

/** Non-cached read for status endpoints. */
async function getAiPaused() {
  try {
    const paused = await readPaused();
    _cache = { paused, loadedAt: Date.now() };
    return paused;
  } catch {
    return _cache.paused;
  }
}

class AiPausedError extends Error {
  constructor() {
    super('AI processing is paused (Admin → AI). Resume it to continue.');
    this.name = 'AiPausedError';
    this.code = 'AI_PAUSED';
  }
}

module.exports = {
  PAUSE_KEY,
  isAiPaused,
  getAiPaused,
  setAiPaused,
  invalidatePauseCache,
  AiPausedError,
};
