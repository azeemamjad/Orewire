/**
 * Official X API v2 OAuth 2.0 client for social automation.
 *
 * Implements Authorization Code Flow with PKCE (RFC 7636) + refresh tokens,
 * as required by X for user-context OAuth 2.0. Posting uses the resulting
 * Bearer access token against POST /2/tweets.
 *
 * Runs alongside the legacy OAuth 1.0a implementation in `x-api.js`; the
 * active credential set is chosen by `x-dispatch.js` via `x_auth_mode`.
 *
 * Required X app scopes: tweet.read tweet.write users.read offline.access
 * (`offline.access` is what yields a refresh_token; without it the access
 * token simply expires and the user must reconnect.)
 */
const crypto = require('crypto');
const db = require('../../db');
const { encrypt, decrypt } = require('./secrets');
const { PLATFORM } = require('./settings');

const API_BASE = 'https://api.x.com/2';
const AUTHORIZE_URL = process.env.X_OAUTH2_AUTHORIZE_URL || 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = process.env.X_OAUTH2_TOKEN_URL || `${API_BASE}/oauth2/token`;
const REVOKE_URL = process.env.X_OAUTH2_REVOKE_URL || `${API_BASE}/oauth2/revoke`;

const DEFAULT_SCOPES = 'tweet.read tweet.write users.read offline.access';

/** Refresh this many ms before actual expiry to absorb clock skew / latency. */
const EXPIRY_BUFFER_MS = 120_000;
/** PKCE authorize→callback window. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** state -> { codeVerifier, redirectUri, createdAt }. In-memory (single-instance app). */
const pendingStates = new Map();

function pruneStates() {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > STATE_TTL_MS) pendingStates.delete(key);
  }
}

function base64Url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function createPkcePair() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function scopes() {
  return String(process.env.X_OAUTH2_SCOPES || DEFAULT_SCOPES).trim();
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

async function loadRow() {
  const r = await db.query(
    `SELECT x_auth_mode,
            x_oauth2_client_id, x_oauth2_client_secret_enc,
            x_oauth2_access_token_enc, x_oauth2_refresh_token_enc,
            x_oauth2_expires_at, x_oauth2_scope, x_oauth2_username,
            x_oauth2_status, last_x_oauth2_error, last_x_oauth2_ok_at,
            x_oauth2_redirect_uri
       FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  return r.rows[0] || null;
}

/** Client id/secret from env override the DB (mirrors the OAuth 1.0a behaviour). */
function envClient() {
  const clientId = String(process.env.X_OAUTH2_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.X_OAUTH2_CLIENT_SECRET || '').trim();
  if (!clientId) return null;
  return { clientId, clientSecret, fromEnv: true };
}

async function getClient() {
  const fromEnv = envClient();
  if (fromEnv) return fromEnv;

  const row = await loadRow();
  if (!row?.x_oauth2_client_id) return null;
  return {
    clientId: row.x_oauth2_client_id,
    clientSecret: row.x_oauth2_client_secret_enc ? decrypt(row.x_oauth2_client_secret_enc) : '',
    fromEnv: false,
  };
}

async function getTokens() {
  const row = await loadRow();
  if (!row?.x_oauth2_access_token_enc && !row?.x_oauth2_refresh_token_enc) return null;
  return {
    accessToken: row.x_oauth2_access_token_enc ? decrypt(row.x_oauth2_access_token_enc) : null,
    refreshToken: row.x_oauth2_refresh_token_enc ? decrypt(row.x_oauth2_refresh_token_enc) : null,
    expiresAt: row.x_oauth2_expires_at || null,
    scope: row.x_oauth2_scope || null,
    username: row.x_oauth2_username || null,
  };
}

async function markStatus(status, errorMessage = null, username = null) {
  await db.query(
    `UPDATE social_automation_settings
        SET x_oauth2_status = $2,
            last_x_oauth2_error = $3,
            last_x_oauth2_ok_at = CASE WHEN $2 = 'ok' THEN NOW() ELSE last_x_oauth2_ok_at END,
            x_oauth2_username = COALESCE($4, x_oauth2_username),
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, status, errorMessage, username],
  );
  return { status, errorMessage, username };
}

async function saveClient({ clientId, clientSecret } = {}) {
  const cur = await loadRow();
  const nextId = clientId != null && String(clientId).trim()
    ? String(clientId).trim()
    : (cur?.x_oauth2_client_id || null);
  const nextSecretEnc = clientSecret != null && String(clientSecret).trim()
    ? encrypt(String(clientSecret).trim())
    : (cur?.x_oauth2_client_secret_enc || null);

  if (!nextId) throw new Error('X OAuth 2.0 Client ID is required');

  await db.query(
    `INSERT INTO social_automation_settings
       (platform, x_oauth2_client_id, x_oauth2_client_secret_enc, x_oauth2_status, updated_at)
     VALUES ($1, $2, $3, 'unknown', NOW())
     ON CONFLICT (platform) DO UPDATE SET
       x_oauth2_client_id = EXCLUDED.x_oauth2_client_id,
       x_oauth2_client_secret_enc = COALESCE(EXCLUDED.x_oauth2_client_secret_enc, social_automation_settings.x_oauth2_client_secret_enc),
       x_oauth2_status = 'unknown',
       last_x_oauth2_error = NULL,
       updated_at = NOW()`,
    [PLATFORM, nextId, nextSecretEnc],
  );

  return getPublic();
}

async function saveTokens({ accessToken, refreshToken, expiresIn, scope, redirectUri } = {}) {
  const row = await loadRow();
  const accessEnc = accessToken ? encrypt(accessToken) : (row?.x_oauth2_access_token_enc || null);
  // X rotates refresh tokens; keep the previous one only if the response omitted it.
  const refreshEnc = refreshToken
    ? encrypt(refreshToken)
    : (row?.x_oauth2_refresh_token_enc || null);
  const expiresAt = expiresIn
    ? new Date(Date.now() + Number(expiresIn) * 1000)
    : (row?.x_oauth2_expires_at || null);

  await db.query(
    `UPDATE social_automation_settings
        SET x_oauth2_access_token_enc = $2,
            x_oauth2_refresh_token_enc = $3,
            x_oauth2_expires_at = $4,
            x_oauth2_scope = COALESCE($5, x_oauth2_scope),
            x_oauth2_redirect_uri = COALESCE($6, x_oauth2_redirect_uri),
            x_oauth2_status = 'unknown',
            last_x_oauth2_error = NULL,
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, accessEnc, refreshEnc, expiresAt, scope || null, redirectUri || null],
  );
}

async function clearTokens() {
  await db.query(
    `UPDATE social_automation_settings
        SET x_oauth2_access_token_enc = NULL,
            x_oauth2_refresh_token_enc = NULL,
            x_oauth2_expires_at = NULL,
            x_oauth2_scope = NULL,
            x_oauth2_username = NULL,
            x_oauth2_status = 'unknown',
            last_x_oauth2_error = NULL,
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM],
  );
}

// ---------------------------------------------------------------------------
// Authorize / token endpoints
// ---------------------------------------------------------------------------

function defaultRedirectUri(req) {
  const fromEnv = String(process.env.X_OAUTH2_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv;
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    if (host) return `${proto}://${host}/api/admin/social/x-oauth2/callback`;
  }
  const backend = String(process.env.BACKEND_DOMAIN || '').trim().replace(/\/+$/, '');
  if (backend) return `${backend}/api/admin/social/x-oauth2/callback`;
  return '';
}

function redirectUriFor(req) {
  return defaultRedirectUri(req);
}

async function buildAuthorizeUrl({ req, forceLogin = false } = {}) {
  const client = await getClient();
  if (!client?.clientId) {
    throw new Error('Save the X OAuth 2.0 Client ID first');
  }
  const redirectUri = redirectUriFor(req);
  if (!redirectUri) {
    throw new Error('Could not determine the OAuth 2.0 redirect URI — set X_OAUTH2_REDIRECT_URI or BACKEND_DOMAIN');
  }

  pruneStates();
  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = base64Url(crypto.randomBytes(24));
  pendingStates.set(state, { codeVerifier, redirectUri, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: scopes(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (forceLogin) params.set('force_login', 'true');

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, redirectUri, state };
}

function consumeState(state) {
  pruneStates();
  const key = String(state || '');
  const entry = pendingStates.get(key);
  if (!entry) return null;
  pendingStates.delete(key);
  return entry;
}

async function tokenRequest(body) {
  const client = await getClient();
  if (!client?.clientId) throw new Error('X OAuth 2.0 Client ID is not configured');

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const form = new URLSearchParams(body);
  // Confidential clients (with a secret) authenticate via HTTP Basic; public
  // clients pass client_id in the body. Sending both can be rejected by X.
  if (client.clientSecret) {
    headers.Authorization = basicAuth(client.clientId, client.clientSecret);
  } else {
    form.set('client_id', client.clientId);
  }

  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: form });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail =
      data?.error_description ||
      data?.error ||
      data?.detail ||
      `X OAuth 2.0 token request failed (HTTP ${res.status})`;
    const err = new Error(detail);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function exchangeCode({ code, codeVerifier, redirectUri }) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    redirectUri,
  });
  return data;
}

async function refreshAccessToken() {
  const tokens = await getTokens();
  if (!tokens?.refreshToken) {
    throw new Error('X OAuth 2.0 session has no refresh token — reconnect with X');
  }
  try {
    const data = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    await saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    });
    return data.access_token;
  } catch (err) {
    const msg = err?.message || String(err);
    if (/invalid_grant|invalid_request|unauthorized|expired/i.test(msg)) {
      await markStatus('needs_reconnect', msg);
    } else {
      await markStatus('error', msg);
    }
    throw err;
  }
}

function tokenExpired(expiresAt) {
  if (!expiresAt) return false; // unknown expiry — let the API decide
  return new Date(expiresAt).getTime() - Date.now() < EXPIRY_BUFFER_MS;
}

let refreshInFlight = null;

/** Returns a usable access token, refreshing transparently when near expiry. */
async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    throw new Error('X OAuth 2.0 is not connected — click "Connect with X" first');
  }
  if (tokens.accessToken && !tokenExpired(tokens.expiresAt)) {
    return tokens.accessToken;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function revoke() {
  const client = await getClient();
  const tokens = await getTokens();
  if (!client?.clientId || !tokens?.accessToken) return { revoked: false };
  try {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const form = new URLSearchParams({ token: tokens.accessToken });
    if (client.clientSecret) headers.Authorization = basicAuth(client.clientId, client.clientSecret);
    else form.set('client_id', client.clientId);
    const res = await fetch(REVOKE_URL, { method: 'POST', headers, body: form });
    return { revoked: res.ok, status: res.status };
  } catch (err) {
    console.warn('[x-oauth2] revoke failed (non-fatal):', err?.message || err);
    return { revoked: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Bearer API calls
// ---------------------------------------------------------------------------

async function apiRequest(method, path, { accessToken, body, query } = {}) {
  if (!accessToken) throw new Error('X OAuth 2.0 access token missing');

  const url = new URL(`${API_BASE}${path}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
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
      data?.error_description ||
      data?.error ||
      `X API HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function verifyCredentials(accessToken) {
  const data = await apiRequest('GET', '/users/me', {
    accessToken,
    query: { 'user.fields': 'username,name' },
  });
  return {
    id: data?.data?.id || null,
    username: data?.data?.username || null,
    name: data?.data?.name || null,
  };
}

async function createTweet(accessToken, { text, inReplyToTweetId = null } = {}) {
  const body = { text: String(text || '') };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: String(inReplyToTweetId) };
  }
  const data = await apiRequest('POST', '/tweets', { accessToken, body });
  return {
    id: data?.data?.id || null,
    text: data?.data?.text || body.text,
  };
}

/** Run an authenticated call, refreshing once and retrying on 401. */
async function withAuthRetry(fn) {
  const token = await getValidAccessToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err?.status === 401) {
      const fresh = await refreshAccessToken();
      return fn(fresh);
    }
    throw err;
  }
}

async function ping() {
  try {
    const tokens = await getTokens();
    if (!tokens?.accessToken && !tokens?.refreshToken) {
      await markStatus('error', 'X OAuth 2.0 not connected');
      return { ok: false, error: 'X OAuth 2.0 is not connected — click "Connect with X"' };
    }
    const user = await withAuthRetry((token) => verifyCredentials(token));
    await markStatus('ok', null, user.username || null);
    return { ok: true, user };
  } catch (err) {
    const msg = err?.message || String(err);
    await markStatus('error', msg);
    return { ok: false, error: msg };
  }
}

async function postThread(pages, { dryRun = false } = {}) {
  const tweets = (pages || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  if (!tweets.length) throw new Error('No tweets to post');

  if (dryRun) {
    return { dryRun: true, threadUrl: null, tweetCount: tweets.length, pages: tweets, via: 'x-oauth2' };
  }

  const tokens = await getTokens();
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    throw new Error('X OAuth 2.0 is not connected — click "Connect with X" in Social Automation');
  }

  let username = tokens.username || null;
  try {
    const me = await withAuthRetry((token) => verifyCredentials(token));
    username = me.username || username;
    if (username) await markStatus('ok', null, username);
  } catch (err) {
    // Posting may still be permitted even if /users/me is unavailable on the plan.
    console.warn('[x-oauth2] users/me failed before post:', err?.message || err);
  }

  const results = [];
  let previousId = null;
  for (const text of tweets) {
    const created = await withAuthRetry((token) =>
      createTweet(token, { text, inReplyToTweetId: previousId }),
    );
    if (!created.id) throw new Error('X API returned no tweet id');
    results.push(created);
    previousId = created.id;
  }

  await markStatus('ok', null, username);

  const firstId = results[0]?.id;
  const threadUrl = firstId
    ? (username ? `https://x.com/${username}/status/${firstId}` : `https://x.com/i/web/status/${firstId}`)
    : null;

  return {
    dryRun: false,
    threadUrl,
    tweetCount: results.length,
    results: { tweets: results, mode: 'oauth2-reply-chain' },
    via: 'x-oauth2',
  };
}

// ---------------------------------------------------------------------------
// Public status for the admin UI
// ---------------------------------------------------------------------------

function publicStatus({ client, tokens, row }) {
  const connected = !!(tokens?.accessToken || tokens?.refreshToken);
  const clientSet = !!client?.clientId;
  let status = row?.x_oauth2_status || 'unknown';
  if (!connected && status === 'unknown') status = 'disconnected';
  const expiresAt = row?.x_oauth2_expires_at || null;

  return {
    configured: clientSet && connected,
    clientIdSet: clientSet,
    clientId: client?.clientId || null,
    secretSet: !!(client?.clientSecret || row?.x_oauth2_client_secret_enc),
    connected,
    scope: row?.x_oauth2_scope || null,
    expiresAt,
    expiresInSec: expiresAt
      ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
      : null,
    username: row?.x_oauth2_username || null,
    status,
    lastError: row?.last_x_oauth2_error || null,
    lastOkAt: row?.last_x_oauth2_ok_at || null,
    redirectUri: row?.x_oauth2_redirect_uri || null,
    fromEnv: !!client?.fromEnv,
    scopesRequested: scopes(),
  };
}

async function getPublic() {
  const row = await loadRow();
  let client = null;
  let tokens = null;
  try {
    client = await getClient();
  } catch {
    client = null;
  }
  try {
    tokens = await getTokens();
  } catch {
    tokens = null;
  }
  return publicStatus({ client, tokens, row });
}

module.exports = {
  // config
  getClient,
  saveClient,
  getTokens,
  saveTokens,
  clearTokens,
  revoke,
  markStatus,
  getPublic,
  getValidAccessToken,
  refreshAccessToken,
  // oauth flow
  buildAuthorizeUrl,
  consumeState,
  exchangeCode,
  redirectUriFor,
  defaultRedirectUri,
  scopes,
  // api
  verifyCredentials,
  createTweet,
  ping,
  postThread,
  // testing seams
  _createPkcePair: createPkcePair,
  _pendingStates: pendingStates,
};
