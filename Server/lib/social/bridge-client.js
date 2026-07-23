/**
 * Client for the local OreWire WebBridge daemon (via ngrok HTTPS + Bearer).
 */
const db = require('../../db');
const { encrypt, decrypt } = require('./secrets');
const { PLATFORM } = require('./settings');

const PING_TIMEOUT_MS = Number(process.env.SOCIAL_BRIDGE_PING_TIMEOUT_MS) || 15_000;
const POST_TIMEOUT_MS = Number(process.env.SOCIAL_BRIDGE_POST_TIMEOUT_MS) || 300_000;

function normalizeBaseUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    throw new Error('Bridge URL must start with https:// (ngrok HTTPS URL)');
  }
  return u;
}

async function loadBridgeRow() {
  const r = await db.query(
    `SELECT bridge_url, bridge_token_enc, bridge_status, last_bridge_error, last_bridge_ok_at
       FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  return r.rows[0] || null;
}

/**
 * Resolve bridge URL + token (DB, with optional env overrides).
 */
async function getBridgeCredentials() {
  const envUrl = (process.env.SOCIAL_BRIDGE_URL || '').trim();
  const envToken = (process.env.SOCIAL_BRIDGE_TOKEN || '').trim();
  const row = await loadBridgeRow();

  const url = normalizeBaseUrl(envUrl || row?.bridge_url || '');
  const token = envToken || (row?.bridge_token_enc ? decrypt(row.bridge_token_enc) : '') || '';

  return {
    url,
    token: String(token || '').trim(),
    fromEnv: !!(envUrl || envToken),
    status: row?.bridge_status || 'unknown',
    lastError: row?.last_bridge_error || null,
    lastOkAt: row?.last_bridge_ok_at || null,
  };
}

function isBridgeConfigured(creds) {
  return !!(creds?.url && creds?.token);
}

async function markBridgeStatus(status, errorMessage = null) {
  const okAt = status === 'ok' ? new Date() : null;
  await db.query(
    `UPDATE social_automation_settings
        SET bridge_status = $2,
            last_bridge_error = $3,
            last_bridge_ok_at = CASE WHEN $2 = 'ok' THEN NOW() ELSE last_bridge_ok_at END,
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, status, errorMessage],
  );
  return { status, errorMessage, okAt };
}

async function saveBridgeConfig({ url, token } = {}) {
  const nextUrl = url !== undefined ? normalizeBaseUrl(url) : undefined;
  const tokenTrimmed = token != null ? String(token).trim() : '';

  const cur = await loadBridgeRow();
  const bridgeUrl = nextUrl !== undefined ? nextUrl : (cur?.bridge_url || '');
  if (!bridgeUrl) throw new Error('Bridge URL is required');

  let tokenEnc = cur?.bridge_token_enc || null;
  if (tokenTrimmed) {
    tokenEnc = encrypt(tokenTrimmed);
  } else if (!tokenEnc && !process.env.SOCIAL_BRIDGE_TOKEN) {
    throw new Error('Bridge token is required (paste once; leave blank to keep existing)');
  }

  await db.query(
    `INSERT INTO social_automation_settings
       (platform, bridge_url, bridge_token_enc, bridge_status, last_bridge_error, updated_at)
     VALUES ($1, $2, $3, 'unknown', NULL, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       bridge_url = EXCLUDED.bridge_url,
       bridge_token_enc = COALESCE(EXCLUDED.bridge_token_enc, social_automation_settings.bridge_token_enc),
       bridge_status = 'unknown',
       last_bridge_error = NULL,
       updated_at = NOW()`,
    [PLATFORM, bridgeUrl, tokenEnc],
  );

  return getBridgePublic();
}

function publicBridge(creds, row) {
  return {
    configured: isBridgeConfigured(creds),
    url: creds.url || '',
    tokenSet: !!(creds.token || row?.bridge_token_enc),
    status: row?.bridge_status || creds.status || 'unknown',
    lastError: row?.last_bridge_error || creds.lastError || null,
    lastOkAt: row?.last_bridge_ok_at || creds.lastOkAt || null,
    fromEnv: !!creds.fromEnv,
  };
}

async function getBridgePublic() {
  const row = await loadBridgeRow();
  let creds;
  try {
    creds = await getBridgeCredentials();
  } catch {
    creds = { url: row?.bridge_url || '', token: '', fromEnv: false };
  }
  return publicBridge(creds, row);
}

async function fetchBridge(path, { method = 'GET', body, timeoutMs } = {}) {
  const creds = await getBridgeCredentials();
  if (!isBridgeConfigured(creds)) {
    throw new Error('WebBridge not configured — paste ngrok URL + token in Social Automation');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || PING_TIMEOUT_MS);

  try {
    const res = await fetch(`${creds.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const errMsg = data?.error || `Bridge HTTP ${res.status}`;
      throw new Error(errMsg);
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Bridge request timed out — is ngrok / daemon running?');
    }
    const msg = err?.message || String(err);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|certificate|ngrok/i.test(msg)) {
      throw new Error(`Bridge unreachable (${msg}). Check daemon + ngrok URL.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/status — verify daemon + extension connectivity.
 */
async function ping() {
  try {
    const data = await fetchBridge('/api/status', { timeoutMs: PING_TIMEOUT_MS });
    const connections = Number(data?.connections) || 0;
    if (connections < 1) {
      await markBridgeStatus('error', 'Daemon OK but Chrome extension not connected');
      return {
        ok: false,
        error: 'Daemon reachable but extension not connected — open Chrome with WebBridge loaded',
        data,
      };
    }
    await markBridgeStatus('ok', null);
    return { ok: true, data };
  } catch (err) {
    const msg = err?.message || String(err);
    await markBridgeStatus('error', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Prefer local Playwright hosted browser when enabled / already logged in.
 * Returns null to fall through to WebBridge.
 */
async function tryHostedBrowserPost(tweets) {
  let prefer = false;
  try {
    const { preferHostedBrowserPost, getManager } = require('../hosted-browser');
    prefer = preferHostedBrowserPost();
    const mgr = getManager();
    const st = await mgr.status();
    const ready = st.running && st.loggedIn;

    if (!prefer && !ready) return null;

    if (!st.running) {
      if (!prefer) return null;
      await mgr.start({ headed: false });
    }

    const loggedIn =
      typeof mgr.cookiesLoggedIn === 'function'
        ? (await mgr.cookiesLoggedIn()) || (await mgr.isLoggedIn())
        : !!st.loggedIn;
    if (!loggedIn) {
      if (prefer) {
        console.warn(
          '[bridge-client] X Browser not logged in — falling back to WebBridge',
        );
      }
      return null;
    }

    const payload = await mgr.postXThread({ tweets });
    return {
      dryRun: false,
      threadUrl: payload.threadUrl || null,
      tweetCount: payload.tweetCount || tweets.length,
      results: payload,
      via: payload.via || 'x-browser',
    };
  } catch (err) {
    console.warn(
      '[bridge-client] Hosted browser post failed, falling back to WebBridge:',
      err?.message || err,
    );
    return null;
  }
}

/**
 * POST /api/tool post_x_thread
 * @param {string[]} pages - tweet texts in order
 */
async function postThread(pages, { dryRun = false } = {}) {
  const tweets = (pages || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  if (!tweets.length) throw new Error('No tweets to post');

  if (dryRun) {
    return { dryRun: true, threadUrl: null, tweetCount: tweets.length, pages: tweets };
  }

  const hosted = await tryHostedBrowserPost(tweets);
  if (hosted) return hosted;

  const data = await fetchBridge('/api/tool', {
    method: 'POST',
    timeoutMs: POST_TIMEOUT_MS,
    body: { name: 'post_x_thread', args: { tweets } },
  });

  const payload = data?.data || data || {};
  if (payload.error) throw new Error(payload.error);

  await markBridgeStatus('ok', null);

  return {
    dryRun: false,
    threadUrl: payload.threadUrl || null,
    tweetCount: payload.tweetCount || tweets.length,
    results: payload,
    via: 'webbridge',
  };
}

module.exports = {
  getBridgeCredentials,
  isBridgeConfigured,
  getBridgePublic,
  saveBridgeConfig,
  markBridgeStatus,
  ping,
  postThread,
  normalizeBaseUrl,
};
