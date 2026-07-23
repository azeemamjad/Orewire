'use strict';

/**
 * OreWire client for the standalone X Browser service (Server/x-browser).
 * Prefers remote HTTP when X_BROWSER_URL is set; otherwise can run in-process
 * via the legacy local manager (not recommended — run `npm run x-browser`).
 */

const { preferHostedBrowserPost } = require('./config');

function remoteBase() {
  return String(process.env.X_BROWSER_URL || process.env.HOSTED_BROWSER_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function remoteToken() {
  return String(process.env.X_BROWSER_TOKEN || process.env.HOSTED_BROWSER_TOKEN || '').trim();
}

async function remoteFetch(path, { method = 'GET', body } = {}) {
  const base = remoteBase();
  if (!base) throw new Error('X_BROWSER_URL is not set');
  const headers = {
    Authorization: `Bearer ${remoteToken()}`,
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': '1',
  };
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `X Browser HTTP ${res.status}`);
  }
  return data;
}

function getLocalManager() {
  // Lazy: only if someone still embeds locally
  const { HostedBrowserManager } = require('../../x-browser/manager');
  if (!getLocalManager._m) getLocalManager._m = new HostedBrowserManager();
  return getLocalManager._m;
}

function getManager() {
  if (remoteBase()) {
    return {
      async status() {
        return remoteFetch('/api/status');
      },
      async start() {
        return remoteFetch('/api/start', { method: 'POST' });
      },
      async stop() {
        return remoteFetch('/api/stop', { method: 'POST' });
      },
      async openLoginWindow() {
        return remoteFetch('/api/open-login', { method: 'POST' });
      },
      async logout() {
        return remoteFetch('/api/session-logout', { method: 'POST' });
      },
      async cookiesLoggedIn() {
        const st = await remoteFetch('/api/status');
        return !!st.loggedIn;
      },
      async isLoggedIn() {
        const st = await remoteFetch('/api/status');
        return !!st.loggedIn;
      },
      async postXThread({ tweets }) {
        return remoteFetch('/api/post', { method: 'POST', body: { tweets } });
      },
      isRunning() {
        return true; // remote — status endpoint is source of truth
      },
      remote: true,
      viewerUrl: `${remoteBase()}/login`,
    };
  }
  return getLocalManager();
}

async function startHostedBrowser(opts = {}) {
  if (remoteBase()) {
    return getManager().start(opts);
  }
  return getLocalManager().start(opts);
}

async function stopHostedBrowser() {
  if (remoteBase()) return getManager().stop();
  return getLocalManager().stop();
}

function isAutoStartEnabled() {
  // Standalone process owns the browser; main server should not also launch Chromium.
  if (remoteBase()) return false;
  const v = String(process.env.HOSTED_BROWSER || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

module.exports = {
  getManager,
  startHostedBrowser,
  stopHostedBrowser,
  isAutoStartEnabled,
  preferHostedBrowserPost,
  remoteBase,
  remoteToken,
};
