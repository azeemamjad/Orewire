/**
 * Resolve HTTP(S) proxy URLs for X login/posting.
 * Order: SOCIAL_X_PROXY env → residential pool → datacenter pool → direct (null).
 */
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
    const store = require('../../relay/proxy-store');
    if (!store.getCachedProxies().length) {
      try {
        await store.refreshProxyCache();
      } catch {
        /* ignore */
      }
    }
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
  const envProxy = (process.env.SOCIAL_X_PROXY || '').trim();
  if (envProxy) {
    try {
      const u = new URL(envProxy.includes('://') ? envProxy : `http://${envProxy}`);
      out.push({
        server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      });
    } catch {
      out.push({ server: envProxy });
    }
  }

  try {
    const store = require('../../relay/proxy-store');
    if (!store.getCachedProxies().length) {
      try {
        await store.refreshProxyCache();
      } catch {
        /* ignore */
      }
    }
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
      });
    }
  } catch {
    /* ignore */
  }

  out.push(null); // direct
  return out;
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
  isCloudflareBlock,
  friendlyLoginError,
};
