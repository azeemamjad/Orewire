'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.orewire-x-browser');
const DEFAULT_PORT = 10088;

function env(name, fallback = '') {
  const v = String(process.env[name] ?? '').trim();
  return v || fallback;
}

function profileDir() {
  return env('X_BROWSER_PROFILE') || env('HOSTED_BROWSER_PROFILE') || DEFAULT_PROFILE_DIR;
}

function httpPort() {
  const n = parseInt(env('X_BROWSER_PORT', String(DEFAULT_PORT)), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

function httpHost() {
  return env('X_BROWSER_HOST', '0.0.0.0');
}

/** Password for the web login viewer (required in production). */
function accessPassword() {
  return env('X_BROWSER_PASSWORD') || env('HOSTED_BROWSER_PASSWORD') || '';
}

/** Bearer token OreWire uses to call /api/tool (auto-created if missing). */
function apiTokenPath() {
  return path.join(profileDir(), 'api-token.txt');
}

function sessionSecret() {
  const fromEnv = env('X_BROWSER_SESSION_SECRET');
  if (fromEnv) return fromEnv;
  return crypto.createHash('sha256').update(`orewire-x-browser:${profileDir()}`).digest('hex');
}

function loadConfig() {
  return {
    profileDir: profileDir(),
    httpHost: httpHost(),
    httpPort: httpPort(),
    accessPassword: accessPassword(),
    sessionSecret: sessionSecret(),
    apiTokenPath: apiTokenPath(),
    publicDir: path.join(__dirname, 'public'),
  };
}

module.exports = {
  DEFAULT_PROFILE_DIR,
  DEFAULT_PORT,
  profileDir,
  httpPort,
  httpHost,
  accessPassword,
  sessionSecret,
  apiTokenPath,
  loadConfig,
};
