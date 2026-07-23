'use strict';

/**
 * Standalone OreWire X Browser service.
 *
 *   cd Server && npm run x-browser
 *
 * Then open http://HOST:10088/login — enter X_BROWSER_PASSWORD — control Chromium
 * in the page and sign into X. OreWire posts via Bearer token (printed on start).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const { loadConfig } = require('./config');
const { loadOrCreateApiToken } = require('./auth');
const { HostedBrowserManager } = require('./manager');
const { ScreencastHub } = require('./screencast');
const { createApp, attachWebSocket } = require('./http');

async function main() {
  const config = loadConfig();
  const manager = new HostedBrowserManager();
  const screencast = new ScreencastHub(manager);
  const app = createApp({ manager, screencast, config });
  const server = http.createServer(app);
  attachWebSocket(server, { screencast });

  const token = loadOrCreateApiToken();

  await new Promise((resolve, reject) => {
    server.listen(config.httpPort, config.httpHost, (err) => (err ? reject(err) : resolve()));
  });

  console.log(`[x-browser] Listening on http://${config.httpHost}:${config.httpPort}`);
  console.log(`[x-browser] Viewer:  http://127.0.0.1:${config.httpPort}/login`);
  console.log(`[x-browser] Profile: ${config.profileDir}`);
  if (!config.accessPassword) {
    console.warn('[x-browser] WARNING: X_BROWSER_PASSWORD is not set — login will fail until you set it');
  } else {
    console.log('[x-browser] Password gate: enabled (X_BROWSER_PASSWORD)');
  }
  console.log(`[x-browser] API token (for OreWire): ${token}`);
  console.log(`[x-browser] Token also saved at ${config.apiTokenPath}`);

  // Warm the browser so the viewer opens quickly
  manager.start({ headed: false }).catch((err) => {
    console.error('[x-browser] Failed to pre-start Chromium:', err.message || err);
  });
}

main().catch((err) => {
  console.error('[x-browser] Fatal:', err);
  process.exit(1);
});
