/**
 * Resolve HTTP(S) proxy URLs for X login/posting.
 * Order: SOCIAL_X_PROXY env → residential pool → datacenter pool → direct (null).
 */

function parseEnvProxyToPlaywright(envProxy) {
  const raw = String(envProxy || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return {
      server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      label: 'SOCIAL_X_PROXY',
      source: 'env',
    };
  } catch {
    return { server: raw, label: 'SOCIAL_X_PROXY', source: 'env' };
  }
}

async function ensureProxyCache() {
  try {
    const store = require('../../relay/proxy-store');
    if (!store.getCachedProxies().length) {
      try {
        await store.refreshProxyCache();
      } catch {
        /* ignore */
      }
    }
    return store;
  } catch {
    return null;
  }
}

async function listSocialProxyUrls() {
  const urls = [];
  const seen = new Set();

  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const envProxy = (process.env.SOCIAL_X_PROXY || '').trim();
  if (envProxy) push(envProxy);

  try {
    const store = await ensureProxyCache();
    if (!store) throw new Error('no store');
    const enabled = store.getCachedProxies().filter((p) => p.enabled);
    const ordered = [
      ...enabled.filter((p) => p.tier === 'residential'),
      ...enabled.filter((p) => p.tier === 'datacenter'),
    ];
    for (const row of ordered) {
      const p = store.rowToPlaywrightProxy(row);
      if (!p.server) continue;
      const hostPort = String(p.server).replace(/^\w+:\/\//, '');
      const cred = p.username
        ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@`
        : '';
      push(`http://${cred}${hostPort}`);
    }
  } catch {
    /* no proxy pool */
  }

  // Always end with direct (null) as last resort
  urls.push(null);
  return urls;
}

/** Playwright-shaped proxies for browser login (residential first). */
async function listPlaywrightProxies() {
  const out = [];
  const envParsed = parseEnvProxyToPlaywright(process.env.SOCIAL_X_PROXY);
  if (envParsed) out.push(envParsed);

  try {
    const store = await ensureProxyCache();
    if (!store) throw new Error('no store');
    const enabled = store.getCachedProxies().filter((p) => p.enabled);
    const ordered = [
      ...enabled.filter((p) => p.tier === 'residential'),
      ...enabled.filter((p) => p.tier === 'datacenter'),
    ];
    for (const row of ordered) {
      const p = store.rowToPlaywrightProxy(row);
      if (!p.server) continue;
      out.push({
        server: p.server,
        username: p.username || undefined,
        password: p.password || undefined,
        label: p.label || row.name || `residential#${row.id}`,
        source: row.tier,
        proxyId: row.id,
      });
    }
  } catch {
    /* ignore */
  }

  out.push(null); // direct
  return out;
}

/**
 * Residential-only Playwright proxy for the X Browser (manual login + hosted posts).
 * Never falls back to datacenter or direct IP.
 *
 * Resolution order: SOCIAL_X_PROXY env → first enabled residential row in proxy pool.
 * @returns {Promise<{ server: string, username?: string, password?: string, label: string, source: string, proxyId?: number }>}
 */
async function requireResidentialPlaywrightProxy() {
  const envParsed = parseEnvProxyToPlaywright(process.env.SOCIAL_X_PROXY);
  if (envParsed?.server) return envParsed;

  const store = await ensureProxyCache();
  if (store) {
    const residential = store
      .getCachedProxies()
      .filter((p) => p.enabled && p.tier === 'residential');
    if (residential.length) {
      // Rotate across residential rows so sessions aren't sticky to one IP forever.
      const row = residential[Math.floor(Math.random() * residential.length)];
      const p = store.rowToPlaywrightProxy(row);
      if (p.server) {
        return {
          server: p.server,
          username: p.username || undefined,
          password: p.password || undefined,
          label: p.label || row.name || `residential#${row.id}`,
          source: 'residential',
          proxyId: row.id,
        };
      }
    }
  }

  throw new Error(
    'X Browser requires a residential proxy. ' +
      'Enable a residential proxy in Admin → Proxies, or set SOCIAL_X_PROXY.',
  );
}

function isCloudflareBlock(errOrBody) {
  const s = String(errOrBody?.message || errOrBody || '');
  return (
    /cloudflare|cf-ray|attention required|sorry, you have been blocked/i.test(s) ||
    (/HTTP 403/.test(s) && /<!DOCTYPE html>/i.test(s)) ||
    /Just a moment/i.test(s)
  );
}

function friendlyLoginError(err) {
  const msg = err?.message || String(err);
  if (isCloudflareBlock(err) || isCloudflareBlock(msg)) {
    return (
      'X blocked this server IP (Cloudflare 403). ' +
      'Automated login will not work from here — paste session cookies instead ' +
      '(Social Automation → Advanced → auth_token + ct0 from your browser).'
    );
  }
  if (/Invalid ATT|code":366/i.test(msg)) {
    return (
      'X rejected the login anti-bot token (ATT). ' +
      'Paste session cookies from Chrome, or set SOCIAL_X_PROXY to a residential proxy.'
    );
  }
  return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
}

module.exports = {
  listSocialProxyUrls,
  listPlaywrightProxies,
  requireResidentialPlaywrightProxy,
  isCloudflareBlock,
  friendlyLoginError,
};
