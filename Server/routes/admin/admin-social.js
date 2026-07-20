const express = require('express');
const cron = require('node-cron');
const { getSettings, updateSettings } = require('../../lib/social/settings');
const {
  saveCredentials,
  publicAccount,
  getAccount,
} = require('../../lib/social/accounts');
const { loginWithStoredCredentials, importSessionCookies } = require('../../lib/social/x-client');
const { runSocialPost, getStatusSnapshot } = require('../../lib/social/run');
const { getAnalytics } = require('../../lib/social/analytics');
const { rescheduleSocialScheduler } = require('../../lib/social/scheduler');

const router = express.Router();

// GET /api/admin/social/status
router.get('/status', async (_req, res) => {
  try {
    const snap = await getStatusSnapshot();
    res.json(snap);
  } catch (err) {
    console.error('[social] status failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load social status' });
  }
});

// PUT /api/admin/social/settings
router.put('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.cron !== undefined && body.cron !== null && body.cron !== '') {
      if (!cron.validate(String(body.cron).trim())) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Play requires credentials + successful login status
    if (body.enabled === true) {
      const account = await getAccount();
      if (!account?.password_enc && !account?.session_cookie_enc) {
        return res.status(400).json({ error: 'Save X credentials or import session cookies before enabling' });
      }
      if (account.status !== 'ok') {
        return res.status(400).json({
          error: 'Test login or Import cookies must succeed before enabling automation',
          status: account.status,
        });
      }
    }

    const settings = await updateSettings({
      enabled: body.enabled,
      cron: body.cron,
      timezone: body.timezone,
      items_min: body.itemsMin ?? body.items_min,
      items_max: body.itemsMax ?? body.items_max,
      dry_run: body.dryRun ?? body.dry_run,
    });

    if (body.cron !== undefined || body.timezone !== undefined) {
      try {
        await rescheduleSocialScheduler();
      } catch (err) {
        console.warn('[social] Reschedule failed:', err?.message || err);
      }
    }

    res.json({ settings });
  } catch (err) {
    console.error('[social] settings update failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to update settings' });
  }
});

// PUT /api/admin/social/x/credentials
router.put('/x/credentials', async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    const row = await saveCredentials({ username, password, email });
    res.json({ account: publicAccount(row) });
  } catch (err) {
    console.error('[social] save credentials failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to save credentials' });
  }
});

// POST /api/admin/social/x/login-test
router.post('/x/login-test', async (_req, res) => {
  try {
    const account = await getAccount();
    if (!account?.password_enc) {
      return res.status(400).json({ error: 'Save credentials first' });
    }
    const { user } = await loginWithStoredCredentials();
    const updated = await getAccount();
    res.json({
      ok: true,
      user: user ? { id: user.id, username: user.username, name: user.name } : null,
      account: publicAccount(updated),
    });
  } catch (err) {
    console.error('[social] login-test failed:', err?.message || err);
    const updated = await getAccount().catch(() => null);
    res.status(400).json({
      ok: false,
      error: err?.message || 'Login failed',
      account: publicAccount(updated),
    });
  }
});

// POST /api/admin/social/x/import-cookies — paste auth_token=…; ct0=… from browser
router.post('/x/import-cookies', async (req, res) => {
  try {
    const cookieString = String(req.body?.cookies || req.body?.cookieString || '').trim();
    if (!cookieString) return res.status(400).json({ error: 'cookies required' });
    const result = await importSessionCookies(cookieString);
    const updated = await getAccount();
    res.json({
      ok: true,
      user: result.user
        ? { id: result.user.id, username: result.user.username, name: result.user.name }
        : null,
      account: publicAccount(updated),
      verified: !!result.verified,
      warning: result.warning || null,
    });
  } catch (err) {
    console.error('[social] import-cookies failed:', err?.message || err);
    res.status(400).json({ ok: false, error: err?.message || 'Import failed' });
  }
});

// POST /api/admin/social/run-now
router.post('/run-now', async (_req, res) => {
  try {
    const result = await runSocialPost({ trigger: 'manual', force: true });
    if (!result.ok && !result.skipped) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[social] run-now failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Run failed' });
  }
});

// GET /api/admin/social/analytics
router.get('/analytics', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 30;
    const data = await getAnalytics({ limit });
    res.json(data);
  } catch (err) {
    console.error('[social] analytics failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Convenience: also expose settings GET
router.get('/settings', async (_req, res) => {
  try {
    res.json({ settings: await getSettings() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

module.exports = router;
