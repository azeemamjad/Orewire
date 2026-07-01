const { chromium } = require('playwright');

/**
 * Proxy fallback tiers in priority order:
 *   1. Datacenter proxy  (PROXY_SERVER / PROXY_USERNAME / PROXY_PASSWORD)
 *   2. Residential proxy  (PROXY_SERVER_2 / PrOXY_USERNAME_2 / PROXY_PASSWORD_2)
 *   3. Direct connection  (no proxy)
 */
function getProxyTiers() {
  const tiers = [];

  // Tier 1 — Datacenter proxy
  if (process.env.USE_PROXY === 'true' && process.env.PROXY_SERVER) {
    const server = process.env.PROXY_SERVER.startsWith('http')
      ? process.env.PROXY_SERVER
      : `http://${process.env.PROXY_SERVER}`;
    tiers.push({
      label: 'datacenter',
      server,
      username: process.env.PROXY_USERNAME || null,
      password: process.env.PROXY_PASSWORD || null,
    });
  }

  // Tier 2 — Residential proxy
  if (process.env.PROXY_SERVER_2) {
    const server = process.env.PROXY_SERVER_2.startsWith('http')
      ? process.env.PROXY_SERVER_2
      : `http://${process.env.PROXY_SERVER_2}`;
    tiers.push({
      label: 'residential',
      server,
      username: process.env.PrOXY_USERNAME_2 || process.env.PROXY_USERNAME_2 || null,
      password: process.env.PROXY_PASSWORD_2 || null,
    });
  }

  // Tier 3 — Direct (always available)
  tiers.push({ label: 'direct', server: null, username: null, password: null });

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

/**
 * Run `fn(browser, tier)` with each proxy tier until one succeeds.
 * On network errors, closes the browser and tries the next tier.
 * On non-network errors, re-throws immediately.
 */
async function withProxyFallback(fn) {
  const tiers  = getProxyTiers();
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
        try { await browser.close(); } catch {}
      }
    }
  }

  throw lastErr;
}

module.exports = { getProxyTiers, buildLaunchOptions, isNetworkError, withProxyFallback };