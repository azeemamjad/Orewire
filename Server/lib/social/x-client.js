/**
 * X client for Social Automation: login → cache cookies → postThread.
 * Uses local HTTP helper (no xactions package — keeps Docker npm ci working).
 */
const {
  getDecryptedCredentials,
  saveSession,
  markAccountStatus,
} = require('./accounts');
const { XHttpClient } = require('./x-http');

function getProxyUrl() {
  const p = (process.env.SOCIAL_X_PROXY || '').trim();
  return p || null;
}

async function makeFetch() {
  const proxy = getProxyUrl();
  if (!proxy) return globalThis.fetch;
  try {
    const undici = require('undici');
    const agent = new undici.ProxyAgent(proxy);
    return (url, opts = {}) => undici.fetch(url, { ...opts, dispatcher: agent });
  } catch (err) {
    console.warn('[social-x] Proxy requested but undici ProxyAgent unavailable:', err?.message || err);
    return globalThis.fetch;
  }
}

function extractThreadUrl(results, username) {
  if (!Array.isArray(results) || !results.length) return null;
  const first = results[0];
  const id =
    first?.rest_id ||
    first?.legacy?.id_str ||
    first?.tweet?.rest_id ||
    first?.id ||
    null;
  if (!id) return null;
  const user = String(username || '').replace(/^@/, '') || 'i';
  return `https://x.com/${user}/status/${id}`;
}

async function loginWithStoredCredentials() {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error('X credentials not configured');
  }

  const client = new XHttpClient({ fetchFn: await makeFetch() });
  try {
    const user = await client.loginWithCredentials(creds.username, creds.password, creds.email || '');
    const cookieString = client.getCookieString();
    if (!cookieString || !client.isAuthenticated()) {
      throw new Error('Login completed but session cookies missing');
    }
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await saveSession({ cookieString, expiresAt });
    return { user, cookieString };
  } catch (err) {
    const msg = err?.message || String(err);
    await markAccountStatus('needs_login', msg);
    throw err;
  }
}

async function ensureSession({ forceLogin = false } = {}) {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error('X credentials not configured');
  }

  if (!forceLogin && creds.sessionCookie) {
    const client = XHttpClient.fromCookieString(creds.sessionCookie, {
      fetchFn: await makeFetch(),
    });
    if (client.isAuthenticated()) {
      const validation = await client.validateSession();
      if (validation.valid) {
        return { cookieString: creds.sessionCookie, username: validation.user?.username || creds.username };
      }
    }
  }

  const { cookieString, user } = await loginWithStoredCredentials();
  return { cookieString, username: user?.username || creds.username };
}

async function postThread(pages, { dryRun = false } = {}) {
  if (!Array.isArray(pages) || pages.length < 2) {
    throw new Error('Thread needs at least intro + one item');
  }

  if (dryRun) {
    return {
      dryRun: true,
      threadUrl: null,
      results: pages.map((text, i) => ({ index: i, text: text.slice(0, 80) })),
    };
  }

  const session = await ensureSession();
  const tweets = pages.map((text) => ({ text }));
  const client = XHttpClient.fromCookieString(session.cookieString, {
    fetchFn: await makeFetch(),
  });

  try {
    const results = await client.postThread(tweets);
    const threadUrl = extractThreadUrl(results, session.username);
    return { dryRun: false, threadUrl, results };
  } catch (err) {
    const msg = err?.message || String(err);
    const authFail = /auth|cookie|login|401|403|csrf|session/i.test(msg);
    if (authFail) {
      await markAccountStatus('needs_login', msg);
      const fresh = await loginWithStoredCredentials();
      const retry = XHttpClient.fromCookieString(fresh.cookieString, {
        fetchFn: await makeFetch(),
      });
      const results = await retry.postThread(tweets);
      const threadUrl = extractThreadUrl(results, fresh.user?.username || session.username);
      return { dryRun: false, threadUrl, results };
    }
    await markAccountStatus('error', msg);
    throw err;
  }
}

module.exports = {
  loginWithStoredCredentials,
  ensureSession,
  postThread,
  extractThreadUrl,
};
