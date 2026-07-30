/**
 * Official X API v2 client for social automation (OAuth 1.0a user context).
 * Replaces browser/WebBridge posting for create-post / thread reply chains.
 */
const crypto = require('crypto');
const db = require('../../db');
const { encrypt, decrypt } = require('./secrets');
const { PLATFORM } = require('./settings');

const API_BASE = 'https://api.x.com/2';

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthAuthorizationHeader(method, url, creds, extraParams = {}) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const all = { ...oauth, ...extraParams };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join('&');

  const base = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');

  return `OAuth ${Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
    .join(', ')}`;
}

async function loadApiRow() {
  const r = await db.query(
    `SELECT x_api_key_enc, x_api_secret_enc, x_access_token_enc, x_access_secret_enc,
            x_api_status, last_x_api_error, last_x_api_ok_at, x_api_username
       FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  return r.rows[0] || null;
}

function envCreds() {
  const apiKey = String(process.env.X_API_KEY || process.env.TWITTER_API_KEY || '').trim();
  const apiSecret = String(
    process.env.X_API_SECRET || process.env.X_API_KEY_SECRET || process.env.TWITTER_API_SECRET || '',
  ).trim();
  const accessToken = String(
    process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || '',
  ).trim();
  const accessTokenSecret = String(
    process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET || '',
  ).trim();
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret, fromEnv: true };
}

async function getApiCredentials() {
  const fromEnv = envCreds();
  if (fromEnv) return fromEnv;

  const row = await loadApiRow();
  if (!row?.x_api_key_enc || !row?.x_api_secret_enc || !row?.x_access_token_enc || !row?.x_access_secret_enc) {
    return null;
  }
  return {
    apiKey: decrypt(row.x_api_key_enc),
    apiSecret: decrypt(row.x_api_secret_enc),
    accessToken: decrypt(row.x_access_token_enc),
    accessTokenSecret: decrypt(row.x_access_secret_enc),
    fromEnv: false,
  };
}

function isApiConfigured(creds) {
  return !!(creds?.apiKey && creds?.apiSecret && creds?.accessToken && creds?.accessTokenSecret);
}

async function markApiStatus(status, errorMessage = null, username = null) {
  await db.query(
    `UPDATE social_automation_settings
        SET x_api_status = $2,
            last_x_api_error = $3,
            last_x_api_ok_at = CASE WHEN $2 = 'ok' THEN NOW() ELSE last_x_api_ok_at END,
            x_api_username = COALESCE($4, x_api_username),
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, status, errorMessage, username],
  );
  return { status, errorMessage, username };
}

async function saveApiCredentials({
  apiKey,
  apiSecret,
  accessToken,
  accessTokenSecret,
} = {}) {
  const cur = await loadApiRow();
  const nextKey = apiKey != null && String(apiKey).trim() ? encrypt(String(apiKey).trim()) : cur?.x_api_key_enc;
  const nextSecret = apiSecret != null && String(apiSecret).trim()
    ? encrypt(String(apiSecret).trim())
    : cur?.x_api_secret_enc;
  const nextToken = accessToken != null && String(accessToken).trim()
    ? encrypt(String(accessToken).trim())
    : cur?.x_access_token_enc;
  const nextTokenSecret = accessTokenSecret != null && String(accessTokenSecret).trim()
    ? encrypt(String(accessTokenSecret).trim())
    : cur?.x_access_secret_enc;

  if (!nextKey || !nextSecret || !nextToken || !nextTokenSecret) {
    throw new Error('All four X API credentials are required (API key, API secret, access token, access secret)');
  }

  await db.query(
    `INSERT INTO social_automation_settings
       (platform, x_api_key_enc, x_api_secret_enc, x_access_token_enc, x_access_secret_enc,
        x_api_status, last_x_api_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'unknown', NULL, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       x_api_key_enc = EXCLUDED.x_api_key_enc,
       x_api_secret_enc = EXCLUDED.x_api_secret_enc,
       x_access_token_enc = EXCLUDED.x_access_token_enc,
       x_access_secret_enc = EXCLUDED.x_access_secret_enc,
       x_api_status = 'unknown',
       last_x_api_error = NULL,
       updated_at = NOW()`,
    [PLATFORM, nextKey, nextSecret, nextToken, nextTokenSecret],
  );

  return getApiPublic();
}

function publicApi(creds, row) {
  const configured = isApiConfigured(creds) || !!(
    row?.x_api_key_enc && row?.x_api_secret_enc && row?.x_access_token_enc && row?.x_access_secret_enc
  );
  return {
    configured,
    credentialsSet: configured,
    status: row?.x_api_status || 'unknown',
    lastError: row?.last_x_api_error || null,
    lastOkAt: row?.last_x_api_ok_at || null,
    username: row?.x_api_username || null,
    fromEnv: !!creds?.fromEnv,
  };
}

async function getApiPublic() {
  const row = await loadApiRow();
  let creds = null;
  try {
    creds = await getApiCredentials();
  } catch {
    creds = null;
  }
  return publicApi(creds, row);
}

async function xRequest(method, path, { creds, body, query } = {}) {
  if (!isApiConfigured(creds)) {
    throw new Error('X API credentials not configured');
  }

  const url = new URL(`${API_BASE}${path}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const queryParams = {};
  for (const [k, v] of url.searchParams.entries()) queryParams[k] = v;

  const authUrl = `${url.origin}${url.pathname}`;
  const headers = {
    Authorization: oauthAuthorizationHeader(method, authUrl, creds, queryParams),
  };

  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail =
      data?.detail ||
      data?.title ||
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.message ||
      data?.error ||
      `X API HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function verifyCredentials(creds) {
  const data = await xRequest('GET', '/users/me', {
    creds,
    query: { 'user.fields': 'username,name' },
  });
  return {
    id: data?.data?.id || null,
    username: data?.data?.username || null,
    name: data?.data?.name || null,
  };
}

async function createTweet(creds, { text, inReplyToTweetId = null } = {}) {
  const body = { text: String(text || '') };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: String(inReplyToTweetId) };
  }
  const data = await xRequest('POST', '/tweets', { creds, body });
  return {
    id: data?.data?.id || null,
    text: data?.data?.text || body.text,
  };
}

/**
 * POST /api/admin/social/x-api/test — verify OAuth credentials against /2/users/me
 */
async function ping() {
  try {
    const creds = await getApiCredentials();
    if (!isApiConfigured(creds)) {
      await markApiStatus('error', 'X API credentials not configured');
      return { ok: false, error: 'X API credentials not configured — set env or paste keys in Social Automation' };
    }
    const user = await verifyCredentials(creds);
    await markApiStatus('ok', null, user.username || null);
    return { ok: true, user };
  } catch (err) {
    const msg = err?.message || String(err);
    await markApiStatus('error', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Post a thread via sequential create-post + reply chain.
 * @param {string[]} pages
 */
async function postThread(pages, { dryRun = false } = {}) {
  const tweets = (pages || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  if (!tweets.length) throw new Error('No tweets to post');

  if (dryRun) {
    return { dryRun: true, threadUrl: null, tweetCount: tweets.length, pages: tweets, via: 'x-api' };
  }

  const creds = await getApiCredentials();
  if (!isApiConfigured(creds)) {
    throw new Error('X API credentials not configured — set X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET');
  }

  let username = null;
  try {
    const me = await verifyCredentials(creds);
    username = me.username || null;
    if (username) await markApiStatus('ok', null, username);
  } catch (err) {
    // Still attempt posting; auth may allow write even if /users/me fails on some plans
    console.warn('[x-api] users/me failed before post:', err?.message || err);
  }

  const results = [];
  let previousId = null;
  for (const text of tweets) {
    const created = await createTweet(creds, {
      text,
      inReplyToTweetId: previousId,
    });
    if (!created.id) throw new Error('X API returned no tweet id');
    results.push(created);
    previousId = created.id;
  }

  await markApiStatus('ok', null, username);

  const firstId = results[0]?.id;
  const threadUrl = firstId
    ? (username ? `https://x.com/${username}/status/${firstId}` : `https://x.com/i/web/status/${firstId}`)
    : null;

  return {
    dryRun: false,
    threadUrl,
    tweetCount: results.length,
    results: { tweets: results, mode: 'reply-chain' },
    via: 'x-api',
  };
}

module.exports = {
  getApiCredentials,
  isApiConfigured,
  getApiPublic,
  saveApiCredentials,
  markApiStatus,
  ping,
  postThread,
  verifyCredentials,
  createTweet,
};
