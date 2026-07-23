'use strict';

/**
 * Client for X Browser: prefers in-process embedded runtime, else remote URL.
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

function useRemote() {
  const base = remoteBase();
  if (!base) return false;
  // If embedded in this process, ignore localhost remote (that was the 500 cause)
  try {
    const { isEmbedded } = require('../../x-browser/runtime');
    if (isEmbedded()) return false;
  } catch {
    /* ignore */
  }
  // Treat same-machine :10088 as "want remote standalone" only if not embedded
  return true;
}

async function remoteFetch(path, { method = 'GET', body } = {}) {
  const base = remoteBase();
  if (!base) throw new Error('X_BROWSER_URL is not set');
  const headers = {
    Authorization: `Bearer ${remoteToken()}`,
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': '1',
  };
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Cannot reach X Browser at ${base} (${err.message}). ` +
        `On Dokploy, set X_BROWSER_PASSWORD and redeploy so it embeds at /x-browser — ` +
        `or run a separate \`npm run x-browser\` process.`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `X Browser HTTP ${res.status}`);
  }
  return data;
}

function getLocalManager() {
  const { getRuntime } = require('../../x-browser/runtime');
  return getRuntime().manager;
}

function wrapLocal(manager) {
  let mountPath = '/x-browser';
  try {
    const { getRuntime } = require('../../x-browser/runtime');
    mountPath = getRuntime().mountPath || mountPath;
  } catch {
    /* ignore */
  }
  return {
    remote: false,
    viewerUrl: mountPath ? `${mountPath}/login` : null,
    async status() {
      const st = await manager.status();
      st.viewerUrl = this.viewerUrl;
      return st;
    },
    start: (opts) => manager.start(opts),
    stop: () => manager.stop(),
    openLoginWindow: () => manager.openLoginWindow(),
    logout: () => manager.logout(),
    cookiesLoggedIn: () => manager.cookiesLoggedIn(),
    isLoggedIn: () => manager.isLoggedIn(),
    postXThread: (args) => manager.postXThread(args),
    isRunning: () => manager.isRunning(),
  };
}

function getManager() {
  if (useRemote()) {
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
        return true;
      },
      remote: true,
      viewerUrl: `${remoteBase()}/login`,
    };
  }
  return wrapLocal(getLocalManager());
}

async function startHostedBrowser(opts = {}) {
  return getManager().start(opts);
}

async function stopHostedBrowser() {
  return getManager().stop();
}

function isAutoStartEnabled() {
  if (useRemote()) return false;
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
  useRemote,
};
