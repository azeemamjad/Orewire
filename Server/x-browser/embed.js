'use strict';

/**
 * Mount X Browser under the main OreWire HTTP server (same Cloudflare origin).
 * Viewer: https://backend.orewire.com/x-browser/login
 */

const { loadConfig } = require('./config');
const { loadOrCreateApiToken } = require('./auth');
const { createRouter, attachWebSocket } = require('./http');
const { getRuntime, markEmbedded } = require('./runtime');

const DEFAULT_MOUNT = '/x-browser';

function shouldEmbed() {
  const flag = String(process.env.X_BROWSER_EMBED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  // Auto-embed when password is configured (typical Dokploy single-service setup)
  return !!String(process.env.X_BROWSER_PASSWORD || '').trim();
}

/**
 * @param {import('express').Express} app
 * @param {import('http').Server} server
 * @param {{ mountPath?: string }} [opts]
 */
function attachXBrowser(app, server, opts = {}) {
  const mountPath = String(opts.mountPath || DEFAULT_MOUNT).replace(/\/$/, '') || DEFAULT_MOUNT;
  const config = loadConfig();
  const rt = markEmbedded(mountPath);
  const { manager, screencast } = rt;

  app.use(mountPath, createRouter({ manager, screencast, config, mountPath }));
  attachWebSocket(server, { screencast, path: `${mountPath}/ws` });

  const token = loadOrCreateApiToken();
  console.log(`[x-browser] Embedded at ${mountPath}`);
  console.log(`[x-browser] Viewer: ${mountPath}/login (password: X_BROWSER_PASSWORD)`);
  console.log(`[x-browser] API token: ${token.slice(0, 8)}… (${config.apiTokenPath})`);

  if (!config.accessPassword) {
    console.warn('[x-browser] WARNING: X_BROWSER_PASSWORD is not set');
  }

  // Pre-start Chromium in background (headless) so Start is fast
  manager.start({ headed: false }).catch((err) => {
    console.error(
      '[x-browser] Chromium pre-start failed (Start in Admin may still work after install):',
      err?.message || err,
    );
  });

  return { mountPath, manager, screencast, token };
}

module.exports = { attachXBrowser, shouldEmbed, DEFAULT_MOUNT, getRuntime };
