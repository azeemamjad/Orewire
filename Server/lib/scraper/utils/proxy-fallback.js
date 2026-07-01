const { chromium } = require('playwright');
const {
  getCachedProxies,
  refreshProxyCache,
  rowToPlaywrightProxy,
  getDirectProxyConfig,
} = require('../../../relay/proxy-store');

/**
 * Proxy fallback tiers: datacenter proxies from DB, then residential, then direct.
 */
async function getProxyTiers() {
  if (!getCachedProxies().length) {
    try {
      await refreshProxyCache();
    } catch {
      /* DB may be unavailable in isolated scripts */
    }
  }

  const tiers = [];
  const enabled = getCachedProxies().filter((p) => p.enabled);

  for (const row of enabled.filter((p) => p.tier === 'datacenter')) {
    const proxy = rowToPlaywrightProxy(row);
    tiers.push({
      label: 'datacenter',
      proxy_id: row.id,
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    });
  }

  for (const row of enabled.filter((p) => p.tier === 'residential')) {
    const proxy = rowToPlaywrightProxy(row);
    tiers.push({
      label: 'residential',
      proxy_id: row.id,
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    });
  }

  const direct = getDirectProxyConfig();
  tiers.push({
    label: 'direct',
    proxy_id: null,
    server: direct.server,
    username: direct.username,
    password: direct.password,
  });

  return tiers;
}

function buildLaunchOptions(tier) {
  const opts = {
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  };
  if (tier.server) {
    opts.proxy = { server: tier.server };
    if (tier.username) opts.proxy.username = tier.username;
    if (tier.password) opts.proxy.password = tier.password;
  }
  return opts;
}

function isNetworkError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('err_timed_out')
      || msg.includes('err_connection')
      || msg.includes('err_proxy')
      || msg.includes('net::')
      || msg.includes('econnrefused')
      || msg.includes('econnreset')
      || msg.includes('err_name_not_resolved')
      || msg.includes('err_sock')
      || msg.includes('err_tunnel_connection_failed');
}

async function withProxyFallback(fn) {
  const tiers = await getProxyTiers();
  let lastErr;

  for (const tier of tiers) {
    let browser;
    try {
      browser = await chromium.launch(buildLaunchOptions(tier));
      console.error(`[Proxy] Trying ${tier.label}…`);
      const result = await fn(browser, tier);
      return result;
    } catch (err) {
      lastErr = err;
      if (isNetworkError(err)) {
        console.error(`[Proxy] ${tier.label} failed: ${err.message}, trying next tier…`);
      } else {
        throw err;
      }
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  }

  throw lastErr;
}

module.exports = { getProxyTiers, buildLaunchOptions, isNetworkError, withProxyFallback };
