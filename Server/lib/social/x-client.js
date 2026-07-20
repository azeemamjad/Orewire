/**
 * X client for Social Automation: login → cache cookies → postThread.
 * Tries HTTP + browser login through residential proxies; cookie paste is the
 * reliable path when X/Cloudflare blocks datacenter IPs.
 */
const {
  getDecryptedCredentials,
  saveSession,
  markAccountStatus,
} = require('./accounts');
const { XHttpClient, parseCookieString } = require('./x-http');
const { loginWithBrowser } = require('./x-browser-login');
const {
  listSocialProxyUrls,
  listPlaywrightProxies,
  isCloudflareBlock,
  friendlyLoginError,
} = require('./proxy');

async function makeFetch(proxyUrl) {
  if (!proxyUrl) return globalThis.fetch;
  try {
    const undici = require('undici');
    const agent = new undici.ProxyAgent(proxyUrl);
    return (url, opts = {}) => undici.fetch(url, { ...opts, dispatcher: agent });
  } catch (err) {
    console.warn('[social-x] undici ProxyAgent unavailable:', err?.message || err);
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

async function loginHttp(creds, proxyUrl) {
  const client = new XHttpClient({ fetchFn: await makeFetch(proxyUrl) });
  const user = await client.loginWithCredentials(creds.username, creds.password, creds.email || '');
  const cookieString = client.getCookieString();
  if (!cookieString || !client.isAuthenticated()) {
    throw new Error('HTTP login completed but session cookies missing');
  }
  return { user, cookieString, method: proxyUrl ? 'http+proxy' : 'http' };
}

async function loginBrowser(creds, playwrightProxy) {
  const result = await loginWithBrowser({
    username: creds.username,
    password: creds.password,
    email: creds.email || '',
    proxy: playwrightProxy,
  });
  const client = XHttpClient.fromCookieString(result.cookieString, {
    fetchFn: await makeFetch(null),
  });
  const validation = await client.validateSession();
  if (!validation.valid) {
    console.warn('[social-x] Browser cookies could not be verified:', validation.reason);
  }
  return {
    user: validation.user || result.user,
    cookieString: result.cookieString,
    method: playwrightProxy ? 'browser+proxy' : 'browser',
  };
}

/**
 * Login with stored username/password, validate session, persist cookies.
 */
async function loginWithStoredCredentials() {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error('X credentials not configured');
  }

  const errors = [];

  // 1) HTTP login through proxy list (residential first)
  const proxyUrls = await listSocialProxyUrls();
  for (const proxyUrl of proxyUrls) {
    try {
      const label = proxyUrl ? 'proxy' : 'direct';
      console.log(`[social-x] Trying HTTP login (${label})…`);
      const result = await loginHttp(creds, proxyUrl);
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await saveSession({ cookieString: result.cookieString, expiresAt });
      console.log(`[social-x] Login OK via ${result.method} (@${result.user?.username || creds.username})`);
      return result;
    } catch (err) {
      const friendly = friendlyLoginError(err);
      errors.push(`HTTP: ${friendly}`);
      console.warn('[social-x] HTTP login failed:', friendly);
      // Cloudflare on direct IP — still try proxies; skip repeating identical CF on more directs
      if (isCloudflareBlock(err) && !proxyUrl) {
        // continue to proxied attempts
      }
    }
  }

  // 2) Browser login through residential proxies
  const pwProxies = await listPlaywrightProxies();
  for (const pwProxy of pwProxies) {
    try {
      console.log(`[social-x] Trying browser login (${pwProxy ? 'proxy' : 'direct'})…`);
      const result = await loginBrowser(creds, pwProxy);
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await saveSession({ cookieString: result.cookieString, expiresAt });
      console.log(`[social-x] Login OK via ${result.method} (@${result.user?.username || creds.username})`);
      return result;
    } catch (err) {
      const friendly = friendlyLoginError(err);
      errors.push(`Browser: ${friendly}`);
      console.warn('[social-x] Browser login failed:', friendly);
    }
  }

  const summary =
    'Automated X login is blocked from this server. ' +
    'Open Social Automation → Advanced → paste cookies: auth_token=…; ct0=… ' +
    '(from Chrome DevTools → Application → Cookies → x.com). ' +
    `Details: ${errors.slice(0, 2).join(' | ')}`;
  await markAccountStatus('needs_login', summary);
  throw new Error(summary);
}

/**
 * Import a browser cookie string (auth_token=…; ct0=…).
 * If X blocks verify_credentials from this IP, still accept well-formed cookies
 * (same machine that posts will hit the same block either way — dry_run works;
 * live post needs a working egress / proxy).
 */
async function importSessionCookies(cookieString) {
  const parsed = parseCookieString(cookieString);
  if (!parsed.auth_token || !parsed.ct0) {
    throw new Error('Cookie string must include auth_token and ct0 (paste both, joined with ;)');
  }
  if (parsed.auth_token.length < 20 || parsed.ct0.length < 20) {
    throw new Error('auth_token / ct0 look too short — copy the full values from Chrome');
  }

  const normalized = Object.entries(parsed)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  let validation = { valid: false, user: null, reason: 'not checked' };
  const proxies = await listSocialProxyUrls();
  for (const proxyUrl of proxies) {
    try {
      const client = XHttpClient.fromCookieString(normalized, {
        fetchFn: await makeFetch(proxyUrl),
      });
      validation = await client.validateSession();
      if (validation.valid) break;
      // Hard auth failure — cookies are dead
      if (validation.status === 401 || validation.status === 403) {
        if (!isCloudflareBlock(validation.reason) && validation.status === 401) {
          throw new Error('Cookies expired or invalid (HTTP 401). Log in on x.com and copy fresh auth_token + ct0.');
        }
      }
    } catch (err) {
      if (/expired or invalid \(HTTP 401\)/i.test(err.message)) throw err;
      validation = { valid: false, user: null, reason: err?.message || String(err) };
      console.warn('[social-x] cookie verify attempt failed:', validation.reason);
    }
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await saveSession({ cookieString: normalized, expiresAt });

  if (!validation.valid) {
    // Network / Cloudflare blocked verify — still store cookies so dry_run + later
    // posting via residential proxy can work.
    console.warn('[social-x] Saved cookies without live verify:', validation.reason);
    const account = await getDecryptedCredentials();
    return {
      user: {
        username: account?.username || '',
        id: '',
        name: '',
      },
      cookieString: normalized,
      verified: false,
      warning: `Cookies saved, but X could not be reached to verify (${validation.reason}). Try Run now (dry run) or ensure a residential proxy is enabled.`,
    };
  }

  return {
    user: validation.user,
    cookieString: normalized,
    verified: true,
  };
}

async function ensureSession({ forceLogin = false } = {}) {
  const creds = await getDecryptedCredentials();
  if (!creds?.username || !creds?.password) {
    // Cookie-only accounts: password optional if session exists
    if (!creds?.sessionCookie) throw new Error('X credentials not configured');
  }

  if (!forceLogin && creds.sessionCookie) {
    const client = XHttpClient.fromCookieString(creds.sessionCookie, {
      fetchFn: await makeFetch(null),
    });
    if (client.isAuthenticated()) {
      let validation = await client.validateSession();
      if (!validation.valid) {
        for (const proxyUrl of await listSocialProxyUrls()) {
          if (!proxyUrl) continue;
          const proxied = XHttpClient.fromCookieString(creds.sessionCookie, {
            fetchFn: await makeFetch(proxyUrl),
          });
          validation = await proxied.validateSession();
          if (validation.valid) break;
        }
      }
      if (validation.valid) {
        return {
          cookieString: creds.sessionCookie,
          username: validation.user?.username || creds.username,
        };
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

  // Prefer posting via residential proxy if available
  const proxies = await listSocialProxyUrls();
  let lastErr = null;
  for (const proxyUrl of proxies) {
    try {
      const client = XHttpClient.fromCookieString(session.cookieString, {
        fetchFn: await makeFetch(proxyUrl),
      });
      const results = await client.postThread(tweets);
      const threadUrl = extractThreadUrl(results, session.username);
      return { dryRun: false, threadUrl, results };
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      if (/auth|cookie|login|401|403|csrf|session/i.test(msg) && !isCloudflareBlock(err)) {
        await markAccountStatus('needs_login', msg);
        const fresh = await loginWithStoredCredentials();
        const retry = XHttpClient.fromCookieString(fresh.cookieString, {
          fetchFn: await makeFetch(proxyUrl),
        });
        const results = await retry.postThread(tweets);
        const threadUrl = extractThreadUrl(results, fresh.user?.username || session.username);
        return { dryRun: false, threadUrl, results };
      }
      console.warn('[social-x] postThread attempt failed:', friendlyLoginError(err));
    }
  }

  const msg = friendlyLoginError(lastErr || new Error('postThread failed'));
  await markAccountStatus('error', msg);
  throw new Error(msg);
}

module.exports = {
  loginWithStoredCredentials,
  ensureSession,
  postThread,
  extractThreadUrl,
  importSessionCookies,
};
