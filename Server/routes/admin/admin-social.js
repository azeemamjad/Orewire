const express = require('express');
const cron = require('node-cron');
const { getSettings, updateSettings } = require('../../lib/social/settings');
const {
  saveCredentials,
  publicAccount,
  getAccount,
} = require('../../lib/social/accounts');
const { loginWithStoredCredentials, importSessionCookies } = require('../../lib/social/x-client');
const {
  saveBridgeConfig,
  getBridgePublic,
  ping: pingBridge,
  postThread,
  saveApiCredentials,
  getSocialStatus,
  isSocialConfigured,
  getSocialAuthMode,
  setSocialAuthMode,
  pingXApi,
  getOAuth2Public,
  saveOAuth2Client,
  buildOAuth2AuthorizeUrl,
  consumeOAuth2State,
  exchangeOAuth2Code,
  disconnectOAuth2,
  oauth2RedirectUri,
} = require('../../lib/social/bridge-client');
const {
  runMaterialTick,
  generateForFiling,
  retryMaterialPost,
  listMaterialPosts,
  getMaterialStats,
} = require('../../lib/social/material-run');
const {
  CATEGORY_KEYS,
  TEMPLATES,
  BODY_GUIDE,
  requiredFields,
} = require('../../lib/social/material-templates');
const { rescheduleMaterialScheduler } = require('../../lib/social/material-scheduler');
const { runSocialPost, getStatusSnapshot } = require('../../lib/social/run');
const { getAnalytics } = require('../../lib/social/analytics');
const { rescheduleSocialScheduler } = require('../../lib/social/scheduler');
const db = require('../../db');
const { PLATFORM } = require('../../lib/social/settings');

const router = express.Router();

function parseTweetsFromBody(body = {}) {
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

// GET /api/admin/social/status
router.get('/status', async (req, res) => {
  try {
    const snap = await getStatusSnapshot();
    // Exact URI the user must register in the X app (derived from this request's host)
    snap.oauth2RedirectUri = oauth2RedirectUri(req);
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

    // Play requires the active X credential set configured + last test OK
    if (body.enabled === true) {
      const social = await getSocialStatus();
      if (!social.configured) {
        return res.status(400).json({
          error: social.mode === 'oauth2'
            ? 'Connect X OAuth 2.0 (save Client ID/Secret, then "Connect with X") before enabling'
            : 'Save X API credentials and Test connection before enabling',
          mode: social.mode,
        });
      }
      if (social.status !== 'ok') {
        return res.status(400).json({
          error: 'Test connection must succeed before enabling automation',
          status: social.status,
          mode: social.mode,
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

// PUT /api/admin/social/x-api — save OAuth 1.0a credentials
router.put('/x-api', async (req, res) => {
  try {
    const {
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      api_key,
      api_secret,
      access_token,
      access_token_secret,
    } = req.body || {};
    const xApi = await saveApiCredentials({
      apiKey: apiKey ?? api_key,
      apiSecret: apiSecret ?? api_secret,
      accessToken: accessToken ?? access_token,
      accessTokenSecret: accessTokenSecret ?? access_token_secret,
    });
    res.json({ xApi });
  } catch (err) {
    console.error('[social] save x-api failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to save X API credentials' });
  }
});

// POST /api/admin/social/x-api/test — verify the active credential set against /2/users/me
router.post('/x-api/test', async (_req, res) => {
  try {
    const result = await pingXApi();
    const xApi = await getSocialStatus();
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, xApi, user: null });
    }
    res.json({ ok: true, xApi, user: result.user || null });
  } catch (err) {
    console.error('[social] x-api test failed:', err?.message || err);
    const xApi = await getSocialStatus().catch(() => null);
    res.status(400).json({ ok: false, error: err?.message || 'X API test failed', xApi });
  }
});

// PUT /api/admin/social/bridge — LEGACY WebBridge
router.put('/bridge', async (req, res) => {
  try {
    const { url, token } = req.body || {};
    const bridge = await saveBridgeConfig({ url, token });
    res.json({ bridge });
  } catch (err) {
    console.error('[social] save bridge failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to save bridge config' });
  }
});

// POST /api/admin/social/bridge/test — LEGACY
router.post('/bridge/test', async (_req, res) => {
  try {
    const result = await pingBridge();
    const bridge = await getBridgePublic();
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, bridge, data: result.data || null });
    }
    res.json({ ok: true, bridge, data: result.data });
  } catch (err) {
    console.error('[social] bridge test failed:', err?.message || err);
    const bridge = await getBridgePublic().catch(() => null);
    res.status(400).json({ ok: false, error: err?.message || 'Bridge test failed', bridge });
  }
});

// PUT /api/admin/social/x/credentials — LEGACY
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

// POST /api/admin/social/x/login-test — LEGACY
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

// POST /api/admin/social/x/import-cookies — LEGACY
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

// POST /api/admin/social/compose-post — publish via official X API
router.post('/compose-post', async (req, res) => {
  let runId = null;
  try {
    const tweets = parseTweetsFromBody(req.body || {});
    if (!tweets.length) {
      return res.status(400).json({ error: 'Write at least one tweet (blank line separates a thread)' });
    }
    if (tweets.length > 10) {
      return res.status(400).json({ error: 'Max 10 tweets per thread' });
    }
    for (const t of tweets) {
      if (t.length > 280) {
        return res.status(400).json({ error: `A tweet is over 280 characters (${t.length})` });
      }
    }

    if (!(await isSocialConfigured())) {
      const social = await getSocialStatus();
      return res.status(400).json({
        error: social.mode === 'oauth2'
          ? 'Connect X OAuth 2.0 first (save Client ID/Secret, then "Connect with X")'
          : 'Configure X API credentials first',
        mode: social.mode,
      });
    }

    const ins = await db.query(
      `INSERT INTO social_post_runs (platform, status, trigger, dry_run, item_count, payload)
       VALUES ($1, 'running', 'compose', FALSE, $2, $3::jsonb)
       RETURNING id`,
      [PLATFORM, tweets.length, JSON.stringify({ tweets, via: 'compose' })],
    );
    runId = ins.rows[0].id;

    const posted = await postThread(tweets, { dryRun: false });

    await db.query(
      `UPDATE social_post_runs
          SET finished_at = NOW(),
              status = 'success',
              thread_url = $2,
              payload = payload || $3::jsonb
        WHERE id = $1`,
      [
        runId,
        posted.threadUrl || null,
        JSON.stringify({ mode: posted.results?.mode || null, via: posted.via || 'x-api' }),
      ],
    );

    res.json({
      ok: true,
      runId,
      tweetCount: posted.tweetCount || tweets.length,
      threadUrl: posted.threadUrl || null,
      via: posted.via || 'x-api',
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[social] compose-post failed:', msg);
    if (runId) {
      await db.query(
        `UPDATE social_post_runs
            SET finished_at = NOW(), status = 'error', error = $2
          WHERE id = $1`,
        [runId, msg],
      ).catch(() => {});
    }
    res.status(400).json({ ok: false, runId, error: msg });
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

router.get('/settings', async (_req, res) => {
  try {
    res.json({ settings: await getSettings() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// ---------------------------------------------------------------------------
// X auth mode + OAuth 2.0 (Authorization Code + PKCE)
// ---------------------------------------------------------------------------

// GET /api/admin/social/x-auth-mode
router.get('/x-auth-mode', async (req, res) => {
  try {
    res.json({
      mode: await getSocialAuthMode(),
      oauth2: await getOAuth2Public(),
      redirectUri: oauth2RedirectUri(req),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load auth mode' });
  }
});

// PUT /api/admin/social/x-auth-mode  { mode: 'oauth1' | 'oauth2' }
router.put('/x-auth-mode', async (req, res) => {
  try {
    const mode = await setSocialAuthMode(req.body?.mode);
    res.json({ mode, xApi: await getSocialStatus() });
  } catch (err) {
    res.status(400).json({ error: err?.message || 'Failed to set auth mode' });
  }
});

// PUT /api/admin/social/x-oauth2/client  { clientId, clientSecret }
router.put('/x-oauth2/client', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    const oauth2 = await saveOAuth2Client({ clientId, clientSecret });
    res.json({ oauth2 });
  } catch (err) {
    console.error('[social] save oauth2 client failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to save OAuth 2.0 client' });
  }
});

// GET /api/admin/social/x-oauth2/authorize — build the X authorize URL (PKCE)
router.get('/x-oauth2/authorize', async (req, res) => {
  try {
    const forceLogin = String(req.query.forceLogin || '') === '1';
    const { url, redirectUri } = await buildOAuth2AuthorizeUrl({ req, forceLogin });
    res.json({ url, redirectUri });
  } catch (err) {
    console.error('[social] oauth2 authorize failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to start OAuth 2.0 authorization' });
  }
});

// GET /api/admin/social/x-oauth2/callback — X redirects the browser here
router.get('/x-oauth2/callback', async (req, res) => {
  const back = (params) =>
    res.redirect(`/admin/social-automation.html?${new URLSearchParams(params).toString()}`);
  try {
    const { code, state, error, error_description: errorDescription } = req.query || {};
    if (error) {
      return back({ xoauth2: 'error', msg: String(errorDescription || error) });
    }
    if (!code || !state) {
      return back({ xoauth2: 'error', msg: 'Missing code or state from X' });
    }
    const entry = consumeOAuth2State(state);
    if (!entry) {
      return back({ xoauth2: 'error', msg: 'Authorization expired or state mismatch — click Connect with X again' });
    }
    await exchangeOAuth2Code({
      code: String(code),
      codeVerifier: entry.codeVerifier,
      redirectUri: entry.redirectUri,
    });
    const status = await getOAuth2Public();
    return back({ xoauth2: 'connected', handle: status.username || '' });
  } catch (err) {
    console.error('[social] oauth2 callback failed:', err?.message || err);
    return back({ xoauth2: 'error', msg: err?.message || 'Token exchange failed' });
  }
});

// POST /api/admin/social/x-oauth2/disconnect
router.post('/x-oauth2/disconnect', async (_req, res) => {
  try {
    const result = await disconnectOAuth2();
    res.json({ ok: true, revoked: !!result?.revoked, oauth2: await getOAuth2Public() });
  } catch (err) {
    console.error('[social] oauth2 disconnect failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to disconnect' });
  }
});

// ---------------------------------------------------------------------------
// Material posts — template-driven pipeline (Admin → Social Automation → Material Posts)
// ---------------------------------------------------------------------------

// GET /api/admin/social/material/templates
router.get('/material/templates', async (_req, res) => {
  try {
    const settings = await getSettings();
    const counts = await db.query(
      `SELECT category, COUNT(*)::int AS posted
         FROM social_material_posts WHERE status = 'posted' GROUP BY category`,
    );
    const postedByCategory = Object.fromEntries(counts.rows.map((r) => [r.category, r.posted]));
    res.json({
      categories: settings.material_categories,
      templates: CATEGORY_KEYS.map((key) => ({
        key,
        label: TEMPLATES[key].label,
        short: TEMPLATES[key].short,
        emojis: TEMPLATES[key].emojis,
        linkLine: TEMPLATES[key].linkLine,
        tailHashtags: TEMPLATES[key].tailHashtags || [],
        filingTypes: TEMPLATES[key].filingTypes,
        bodyGuide: BODY_GUIDE[key] || [],
        fields: TEMPLATES[key].fields,
        required: requiredFields(key),
        enabled: settings.material_categories.includes(key),
        posted: postedByCategory[key] || 0,
      })),
    });
  } catch (err) {
    console.error('[social] material templates failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// GET /api/admin/social/material/posts?status=&category=&limit=
router.get('/material/posts', async (req, res) => {
  try {
    const posts = await listMaterialPosts({
      status: req.query.status,
      category: req.query.category,
      limit: req.query.limit,
    });
    res.json({ posts });
  } catch (err) {
    console.error('[social] material posts failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load material posts' });
  }
});

// GET /api/admin/social/material/analytics
router.get('/material/analytics', async (_req, res) => {
  try {
    res.json(await getMaterialStats());
  } catch (err) {
    console.error('[social] material analytics failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load material analytics' });
  }
});

// PUT /api/admin/social/material/settings
router.put('/material/settings', async (req, res) => {
  try {
    const body = req.body || {};

    if (body.material_cron !== undefined && String(body.material_cron).trim()) {
      if (!cron.validate(String(body.material_cron).trim())) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Enabling requires a working X credential set — same gate as the Automation tab.
    if (body.enabled === true) {
      const social = await getSocialStatus();
      if (!social.configured) {
        return res.status(400).json({
          error: social.mode === 'oauth2'
            ? 'Connect X OAuth 2.0 (save Client ID/Secret, then "Connect with X") before enabling'
            : 'Save X API credentials and Test connection before enabling',
          mode: social.mode,
        });
      }
      if (social.status !== 'ok') {
        return res.status(400).json({
          error: 'Test connection must succeed before enabling automation',
          status: social.status,
          mode: social.mode,
        });
      }
    }

    const settings = await updateSettings({
      enabled: body.enabled,
      dry_run: body.dryRun ?? body.dry_run,
      material_cron: body.material_cron,
      material_daily_cap: body.material_daily_cap,
      material_min_gap_minutes: body.material_min_gap_minutes,
      material_min_verdict: body.material_min_verdict,
      material_categories: body.material_categories,
      material_per_company_days: body.material_per_company_days,
    });

    if (body.material_cron !== undefined) {
      try {
        await rescheduleMaterialScheduler();
      } catch (err) {
        console.warn('[social] material reschedule failed:', err?.message || err);
      }
    }

    res.json({ settings });
  } catch (err) {
    console.error('[social] material settings failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Failed to update material settings' });
  }
});

// POST /api/admin/social/material/run-now  { force?, publish? }
router.post('/material/run-now', async (req, res) => {
  try {
    const force = !!req.body?.force;
    const publish = req.body?.publish !== false;
    const result = await runMaterialTick({ trigger: 'manual', force, publish });
    if (!result.ok && !result.skipped) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[social] material run-now failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Material run failed' });
  }
});

// POST /api/admin/social/material/preview  { filingId }
router.post('/material/preview', async (req, res) => {
  try {
    const filingId = Number(req.body?.filingId);
    if (!filingId) return res.status(400).json({ error: 'filingId is required' });
    const result = await generateForFiling(filingId, { publish: false });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[social] material preview failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Preview failed' });
  }
});

// POST /api/admin/social/material/retry/:id
router.post('/material/retry/:id', async (req, res) => {
  try {
    const publish = req.body?.publish !== false;
    const result = await retryMaterialPost(Number(req.params.id), { publish });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[social] material retry failed:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Retry failed' });
  }
});

module.exports = router;
