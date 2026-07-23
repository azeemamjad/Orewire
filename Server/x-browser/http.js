'use strict';

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const {
  checkPassword,
  createSessionCookieValue,
  setSessionCookie,
  clearSessionCookie,
  requireApiBearer,
  loadOrCreateApiToken,
  parseCookies,
  verifySession,
  COOKIE_NAME,
} = require('./auth');
const { accessPassword } = require('./config');

function parseTweets(body = {}) {
  if (Array.isArray(body.tweets)) {
    return body.tweets.map((t) => String(t ?? '').trim()).filter(Boolean);
  }
  const raw = String(body.text || body.content || '').trim();
  if (!raw) return [];
  return raw
    .split(/\n\s*\n+|\n\s*---+\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * @param {{ manager, screencast, config, mountPath?: string }} opts
 * mountPath e.g. '/x-browser' when embedded under main OreWire app.
 */
function createRouter({ manager, screencast, config, mountPath = '' }) {
  const base = String(mountPath || '').replace(/\/$/, '');
  const router = express.Router();

  function requireViewerSession(req, res, next) {
    const cookies = parseCookies(req);
    if (verifySession(cookies[COOKIE_NAME])) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Login required' });
    }
    return res.redirect(`${base}/login`);
  }

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'orewire-x-browser', mountPath: base || null });
  });

  router.get('/login', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'login.html'));
  });

  router.post('/api/login', (req, res) => {
    try {
      if (!accessPassword()) {
        return res.status(503).json({
          error: 'Set X_BROWSER_PASSWORD in the environment before using the viewer',
        });
      }
      if (!checkPassword(req.body?.password)) {
        return res.status(401).json({ error: 'Wrong password' });
      }
      setSessionCookie(res, createSessionCookieValue(), { path: base || '/' });
      res.json({ ok: true, redirect: `${base}/` });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Login failed' });
    }
  });

  router.post('/api/logout-viewer', (_req, res) => {
    clearSessionCookie(res, { path: base || '/' });
    res.json({ ok: true });
  });

  router.get('/api/status', requireApiBearer, async (_req, res) => {
    try {
      const st = await manager.status();
      st.loggedIn = st.loggedIn || (await manager.cookiesLoggedIn());
      st.apiTokenHint = `${loadOrCreateApiToken().slice(0, 8)}…`;
      st.mountPath = base || null;
      res.json(st);
    } catch (err) {
      res.status(500).json({ error: err.message || 'status failed' });
    }
  });

  router.post('/api/start', requireApiBearer, async (_req, res) => {
    try {
      const st = await manager.start({ headed: false });
      st.loggedIn = await manager.cookiesLoggedIn();
      res.json({ ok: true, ...st });
    } catch (err) {
      console.error('[x-browser] start failed:', err?.message || err);
      res.status(500).json({
        ok: false,
        error: err.message || 'Failed to start Chromium (is Playwright installed? npx playwright install chromium)',
      });
    }
  });

  router.post('/api/stop', requireApiBearer, async (_req, res) => {
    try {
      await screencast.stop();
      const st = await manager.stop();
      res.json({ ok: true, ...st });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/api/open-login', requireApiBearer, async (_req, res) => {
    try {
      const result = await screencast.openLoginForViewer();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/api/session-logout', requireApiBearer, async (_req, res) => {
    try {
      await screencast.stop();
      const st = await manager.logout();
      res.json({ ok: true, ...st });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/api/post', requireApiBearer, async (req, res) => {
    try {
      const tweets = parseTweets(req.body || {});
      if (!tweets.length) {
        return res.status(400).json({ ok: false, error: 'tweets or text required' });
      }
      if (!manager.isRunning()) await manager.start({ headed: false });
      const result = await manager.postXThread({ tweets });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/api/tool', requireApiBearer, async (req, res) => {
    try {
      const name = req.body?.name;
      const args = req.body?.args || {};
      if (name === 'post_x_thread') {
        const tweets = Array.isArray(args.tweets) ? args.tweets : args.pages;
        const list = (tweets || []).map((t) => String(t ?? '').trim()).filter(Boolean);
        if (!manager.isRunning()) await manager.start({ headed: false });
        const data = await manager.postXThread({ tweets: list });
        return res.json({ data });
      }
      return res.status(400).json({ error: `Unknown tool: ${name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/', requireViewerSession, (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'viewer.html'));
  });

  router.use(express.static(config.publicDir));

  return router;
}

/** Standalone app (own port). */
function createApp(opts) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(createRouter({ ...opts, mountPath: '' }));
  return app;
}

function attachWebSocket(server, { screencast, path: wsPath = '/ws' }) {
  const wss = new WebSocketServer({ server, path: wsPath });

  wss.on('connection', async (ws, req) => {
    const cookies = parseCookies(req);
    const session = verifySession(cookies[COOKIE_NAME]);
    if (!session) {
      ws.close(4401, 'login required');
      return;
    }

    screencast.addClient(ws);
    try {
      await screencast.start();
      ws.send(JSON.stringify({ type: 'ready', viewport: screencast.viewport }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message || 'screencast failed' }));
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        await screencast.handleInput(msg);
      } catch (err) {
        try {
          ws.send(JSON.stringify({ type: 'error', error: err.message || 'input failed' }));
        } catch {
          /* ignore */
        }
      }
    });
  });

  return wss;
}

module.exports = { createApp, createRouter, attachWebSocket };
