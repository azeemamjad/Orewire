'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.orewire-webbridge');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function readLocalConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeLocalConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function updateLocalConfig(patch) {
  const cur = readLocalConfig();
  if (!cur?.authToken) throw new Error('Local bridge config missing — restart with WEBBRIDGE=1 once');
  const next = { ...cur, ...patch };
  writeLocalConfig(next);
  return next;
}

function loadOrCreateAuthToken() {
  const fromEnv = (process.env.OREWIRE_BRIDGE_TOKEN || process.env.WEBBRIDGE_AUTH_TOKEN || '').trim();
  if (fromEnv) {
    const existing = readLocalConfig();
    if (!existing?.authToken) {
      writeLocalConfig({ authToken: fromEnv, createdAt: new Date().toISOString() });
    }
    console.log('[webbridge] Using bridge token from environment');
    return fromEnv;
  }

  const existing = readLocalConfig();
  if (existing?.authToken && String(existing.authToken).length >= 16) {
    console.log(`[webbridge] Bridge token loaded from ${CONFIG_FILE}`);
    return String(existing.authToken);
  }

  const authToken = crypto.randomBytes(32).toString('hex');
  writeLocalConfig({ authToken, createdAt: new Date().toISOString() });
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  OreWire WebBridge — new bridge token generated              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Token: ${authToken}`);
  console.log(`║  Saved: ${CONFIG_FILE}`);
  console.log('║  Extension popup → paste ngrok authtoken → copy URL + token  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  return authToken;
}

function extractBearer(header) {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(String(raw).trim());
  return m ? m[1] : null;
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    String(ip).endsWith('127.0.0.1')
  );
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  readLocalConfig,
  writeLocalConfig,
  updateLocalConfig,
  loadOrCreateAuthToken,
  extractBearer,
  isLoopbackIp,
};
