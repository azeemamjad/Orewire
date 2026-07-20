/**
 * XActions-backed client: credential login → persist auth cookies → postThread.
 * Uses the HTTP scraper (no browser) which is part of xactions; optional proxy via undici.
 */
const {
  getDecryptedCredentials,
  saveSession,
  markAccountStatus,
} = require('./accounts');

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

async function loadHttp() {
  return import('xactions/scrapers/twitter/http');
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

/**
 * Login with stored username/password, validate session, persist cookies.
 */
async function loginWithStoredCredentials() {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error('X credentials not configured');
  }

  const { TwitterAuth } = await loadHttp();
  const fetchFn = await makeFetch();
  const auth = new TwitterAuth({ fetch: fetchFn });

  try {
    const user = await auth.loginWithCredentials(creds.username, creds.password, creds.email || '');
    const cookieString = auth.getCookieString();
    if (!cookieString || !auth.isAuthenticated()) {
      throw new Error('Login completed but session cookies missing');
    }
    // Session cookies typically last weeks; refresh on auth failure
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await saveSession({ cookieString, expiresAt });
    return { user, cookieString };
  } catch (err) {
    const msg = err?.message || String(err);
    await markAccountStatus('needs_login', msg);
    throw err;
  }
}

/**
 * Ensure we have a usable cookie session; re-login if missing/invalid.
 */
async function ensureSession({ forceLogin = false } = {}) {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error('X credentials not configured');
  }

  if (!forceLogin && creds.sessionCookie) {
    try {
      const { createHttpScraper } = await loadHttp();
      const scraper = await createHttpScraper({
        cookies: creds.sessionCookie,
        proxy: getProxyUrl() || undefined,
        fetch: await makeFetch(),
      });
      // Light validation: authenticated cookie presence is enough; posting will fail loudly if dead
      if (scraper.client?.isAuthenticated?.()) {
        return { cookieString: creds.sessionCookie, username: creds.username };
      }
    } catch {
      /* fall through to login */
    }
  }

  const { cookieString, user } = await loginWithStoredCredentials();
  return { cookieString, username: user?.username || creds.username };
}

/**
 * Post a thread (array of tweet texts). Returns { threadUrl, results }.
 */
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
  const { createHttpScraper } = await loadHttp();
  const scraper = await createHttpScraper({
    cookies: session.cookieString,
    proxy: getProxyUrl() || undefined,
    fetch: await makeFetch(),
  });

  const tweets = pages.map((text) => ({ text }));
  try {
    const results = await scraper.postThread(tweets);
    const threadUrl = extractThreadUrl(results, session.username);
    return { dryRun: false, threadUrl, results };
  } catch (err) {
    const msg = err?.message || String(err);
    const authFail = /auth|cookie|login|401|403|csrf|session/i.test(msg);
    if (authFail) {
      await markAccountStatus('needs_login', msg);
      // One retry with fresh login
      const fresh = await loginWithStoredCredentials();
      const retry = await createHttpScraper({
        cookies: fresh.cookieString,
        proxy: getProxyUrl() || undefined,
        fetch: await makeFetch(),
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
