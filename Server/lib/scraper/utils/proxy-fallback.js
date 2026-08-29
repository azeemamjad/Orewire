/**
 * Proxy fallback for scrapers running *outside* the relay pool
 * (OREWIRE_RELAY !== 'in-process', which is the default).
 *
 * This used to launch vanilla Playwright's bundled Chromium, headless, with the
 * automation flags — the exact combination SEDAR+'s Radware wall rejects. It now
 * goes through relay/engines, so the local path gets the same real-Chrome,
 * patched-driver, persistent-profile, geo-matched browser the relay workers do.
 *
 * The callback contract changed with it: a persistent context has no Browser
 * handle to hand out, so callbacks receive a ready `{ context, page }` session
 * and the lifecycle is owned here.
 */
const {
  getCachedProxies,
  refreshProxyCache,
  rowToPlaywrightProxy,
  getDirectProxyConfig,
} = require('../../../relay/proxy-store');
const { launchSession } = require('../../../relay/engines');
const { resolveRelayHeadless } = require('../../../relay/env');

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
  // Optional: PROXY_ONLY_TIER=direct|residential|datacenter (comma-separated)
  const only = (process.env.PROXY_ONLY_TIER || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

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

  if (!only.length) return tiers;
  const filtered = tiers.filter((t) => only.includes(t.label));
  return filtered.length ? filtered : tiers;
}

function isNetworkError(err) {
  const msg = (err.message || String(err) || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();
  return msg.includes('err_timed_out')
      || msg.includes('err_connection')
      || msg.includes('err_proxy')
      || msg.includes('net::')
      || msg.includes('econnrefused')
      || msg.includes('econnreset')
      || msg.includes('err_name_not_resolved')
      || msg.includes('err_sock')
      || msg.includes('err_tunnel_connection_failed')
      || msg.includes('timeout')
      || msg.includes('timed out')
      || name.includes('timeout');
}

/**
 * Each tier gets its own persistent profile, so a run that falls back from
 * datacenter to residential does not carry the burned session's cookies onto
 * the new IP — which is itself a linkage a wall can score.
 */
function profileIdForTier(tier) {
  return `local-${tier.label}${tier.proxy_id ? `-${tier.proxy_id}` : ''}`;
}

/**
 * @param {(session: { context, page, browser: null, tier: object }) => Promise<any>} fn
 */
async function withProxyFallback(fn) {
  const tiers = await getProxyTiers();
  let lastErr;

  for (const tier of tiers) {
    let session;
    try {
      console.error(`[Proxy] Trying ${tier.label}…`);
      session = await launchSession({
        workerId: profileIdForTier(tier),
        proxy: tier.server ? { server: tier.server, username: tier.username, password: tier.password } : null,
        headless: resolveRelayHeadless(),
      });
      return await fn({ ...session, tier }, tier);
    } catch (err) {
      lastErr = err;
      if (isNetworkError(err)) {
        console.error(`[Proxy] ${tier.label} failed: ${err.message}, trying next tier…`);
      } else {
        throw err;
      }
    } finally {
      if (session?.context) {
        try { await session.context.close(); } catch { /* ignore */ }
      }
    }
  }

  throw lastErr;
}

module.exports = { getProxyTiers, isNetworkError, withProxyFallback };
