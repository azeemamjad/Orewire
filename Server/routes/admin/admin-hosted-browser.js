'use strict';

const express = require('express');
const {
  getManager,
  startHostedBrowser,
  stopHostedBrowser,
  remoteBase,
} = require('../../lib/hosted-browser');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const mgr = getManager();
    const st = await mgr.status();
    if (st.running && !st.loggedIn && typeof mgr.isLoggedIn === 'function') {
      st.loggedIn = await mgr.isLoggedIn();
    }
    st.remoteUrl = remoteBase() || null;
    const { isEmbedded, getRuntime } = require('../../x-browser/runtime');
    if (isEmbedded()) {
      const mount = getRuntime().mountPath || '/x-browser';
      st.viewerUrl = `${req.protocol}://${req.get('host')}${mount}/login`;
    } else {
      st.viewerUrl = mgr.viewerUrl || (remoteBase() ? `${remoteBase()}/login` : null);
    }
    res.json(st);
  } catch (err) {
    console.error('[x-browser] status failed:', err?.message || err);
    res.status(500).json({
      error: err?.message || 'Failed to load status',
      running: false,
      loggedIn: false,
      remoteUrl: remoteBase() || null,
      viewerUrl: `${req.protocol}://${req.get('host')}/x-browser/login`,
    });
  }
});

router.post('/start', async (_req, res) => {
  try {
    const st = await startHostedBrowser({ headed: false });
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to start' });
  }
});

router.post('/stop', async (_req, res) => {
  try {
    const st = await stopHostedBrowser();
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to stop' });
  }
});

router.post('/open-login', async (_req, res) => {
  try {
    const result = await getManager().openLoginWindow();
    res.json({ ok: true, ...result, viewerUrl: remoteBase() ? `${remoteBase()}/login` : null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to open login' });
  }
});

router.post('/logout', async (_req, res) => {
  try {
    const st = await getManager().logout();
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to logout' });
  }
});

router.post('/post', async (req, res) => {
  try {
    const tweets = Array.isArray(req.body?.tweets)
      ? req.body.tweets.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    if (!tweets.length) {
      return res.status(400).json({ ok: false, error: 'tweets required' });
    }
    const result = await getManager().postXThread({ tweets });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Post failed' });
  }
});

module.exports = router;
