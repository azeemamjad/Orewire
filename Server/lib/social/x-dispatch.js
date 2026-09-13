/**
 * Mode-aware X delivery facade.
 *
 * Social automation can post through either credential set:
 *   - 'oauth1' (default) → lib/social/x-api.js  (OAuth 1.0a user context)
 *   - 'oauth2'           → lib/social/x-oauth2.js (OAuth 2.0 + PKCE user context)
 *
 * `x_auth_mode` on social_automation_settings selects the active set; the
 * X_AUTH_MODE env var overrides it. Everything downstream (run.js, the admin
 * routes, the admin UI) talks to this module instead of a specific version.
 */
const db = require('../../db');
const { PLATFORM } = require('./settings');
const oauth1 = require('./x-api');
const oauth2 = require('./x-oauth2');

const MODES = ['oauth1', 'oauth2'];

function normalizeMode(mode) {
  const v = String(mode || '').trim().toLowerCase();
  return MODES.includes(v) ? v : null;
}

async function loadModeRow() {
  const r = await db.query(
    `SELECT x_auth_mode FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  return r.rows[0] || null;
}

/** Active auth mode. X_AUTH_MODE env wins, else the stored value, else oauth1. */
async function getMode() {
  const envMode = normalizeMode(process.env.X_AUTH_MODE);
  if (envMode) return envMode;
  const row = await loadModeRow();
  return normalizeMode(row?.x_auth_mode) || 'oauth1';
}

async function isModeFromEnv() {
  return !!normalizeMode(process.env.X_AUTH_MODE);
}

async function setMode(mode) {
  const m = normalizeMode(mode);
  if (!m) throw new Error("Auth mode must be 'oauth1' or 'oauth2'");
  await db.query(
    `UPDATE social_automation_settings SET x_auth_mode = $2, updated_at = NOW() WHERE platform = $1`,
    [PLATFORM, m],
  );
  return m;
}

/** Combined public status: flat fields reflect the active mode. */
async function getStatus() {
  const [mode, oauth1Status, oauth2Status] = await Promise.all([
    getMode(),
    oauth1.getApiPublic().catch(() => null),
    oauth2.getPublic().catch(() => null),
  ]);

  const active = mode === 'oauth2' ? oauth2Status : oauth1Status;

  return {
    mode,
    modeFromEnv: !!normalizeMode(process.env.X_AUTH_MODE),
    // Flat, active-mode fields (kept for the existing admin UI contract)
    configured: !!active?.configured,
    credentialsSet: !!active?.configured,
    status: active?.status || 'unknown',
    username: active?.username || null,
    lastError: active?.lastError || null,
    lastOkAt: active?.lastOkAt || null,
    fromEnv: !!active?.fromEnv,
    // Per-mode detail
    oauth1: oauth1Status,
    oauth2: oauth2Status,
  };
}

/** True when the active mode has everything needed to post live. */
async function isConfigured() {
  const mode = await getMode();
  if (mode === 'oauth2') {
    const status = await oauth2.getPublic().catch(() => null);
    return !!status?.configured;
  }
  const creds = await oauth1.getApiCredentials().catch(() => null);
  return oauth1.isApiConfigured(creds);
}

function modeNotConfiguredMessage(mode) {
  return mode === 'oauth2'
    ? 'X OAuth 2.0 is not connected — save the Client ID/Secret and click "Connect with X"'
    : 'X API not configured — paste OAuth 1.0a keys in Social Automation or set them in env';
}

/** Verify the active credential set against /2/users/me. */
async function ping() {
  const mode = await getMode();
  if (mode === 'oauth2') return oauth2.ping();
  return oauth1.ping();
}

/** Post a thread through the active credential set. */
async function postThread(pages, opts = {}) {
  const mode = await getMode();
  if (mode === 'oauth2') return oauth2.postThread(pages, opts);
  return oauth1.postThread(pages, opts);
}

module.exports = {
  MODES,
  normalizeMode,
  getMode,
  isModeFromEnv,
  setMode,
  getStatus,
  isConfigured,
  modeNotConfiguredMessage,
  ping,
  postThread,
  oauth1,
  oauth2,
};
