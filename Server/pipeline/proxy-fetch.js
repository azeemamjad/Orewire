// HTTP fetch with tiered proxy fallback (datacenter → residential → direct).
// Matches the Scraper's env-var convention (PROXY_SERVER / PROXY_SERVER_2 / ...).
// Uses undici's ProxyAgent (bundled with Node 18+) so no extra dependency.

const { ProxyAgent } = require('undici');

const PORTS = [8001, 8002, 8003, 8004, 8005];
let _portIdx = 0;

function _stripScheme(url) {
  return url.replace(/^https?:\/\//, '');
}

function _hasPort(host) {
  return /:\d+$/.test(host);
}

function _nextPort() {
  const p = PORTS[_portIdx % PORTS.length];
  _portIdx++;
  return p;
}

function _buildProxyUri(serverEnv, username, password) {
  if (!serverEnv) return null;
  let host = _stripScheme(serverEnv);
  if (!_hasPort(host)) host = `${host}:${_nextPort()}`;
  const auth = (username && password)
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  return `http://${auth}${host}`;
}

function _tiers() {
  const out = [];
  if (process.env.USE_PROXY === 'true' && process.env.PROXY_SERVER) {
    out.push({
      label: 'datacenter',
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD,
    });
  }
  if (process.env.PROXY_SERVER_2) {
    out.push({
      label: 'residential',
      server: process.env.PROXY_SERVER_2,
      // Tolerate the typo'd env var that already exists in the Scraper helper.
      username: process.env.PROXY_USERNAME_2 || process.env.PrOXY_USERNAME_2,
      password: process.env.PROXY_PASSWORD_2,
    });
  }
  out.push({ label: 'direct', server: null });
  return out;
}

// Cloudflare/anti-bot responses we want to retry with the next tier.
function _looksBlocked(res, bodyText) {
  if ([403, 429, 503, 520, 521, 522, 523, 524].includes(res.status)) return true;
  if (res.status === 200 && bodyText && /just a moment|cf-browser-verification|cf-chl-bypass|cloudflare/i.test(bodyText.slice(0, 3000))) return true;
  return false;
}

/**
 * fetchWithProxy(url, fetchOptions, { logger? })
 *   Tries each configured tier until one returns a non-blocked response.
 *   Throws the last error if all tiers fail.
 */
async function fetchWithProxy(url, fetchOpts = {}, { logger } = {}) {
  const log = logger || (() => {});
  const tiers = _tiers();
  let lastErr = null;
  for (const tier of tiers) {
    try {
      const uri = tier.server ? _buildProxyUri(tier.server, tier.username, tier.password) : null;
      const opts = { ...fetchOpts };
      if (uri) opts.dispatcher = new ProxyAgent({ uri });
      const res = await fetch(url, opts);
      // Read body once so we can sniff for Cloudflare challenges.
      const body = await res.text();
      if (_looksBlocked(res, body)) {
        log(`[proxy] ${tier.label} → ${res.status} (blocked), trying next tier`);
        lastErr = new Error(`Blocked (${res.status}) on ${tier.label}`);
        continue;
      }
      // Re-wrap so callers see a normal Response-like object.
      return { ok: res.ok, status: res.status, url: res.url, text: () => Promise.resolve(body), via: tier.label };
    } catch (err) {
      log(`[proxy] ${tier.label} → ERROR ${err.message}, trying next tier`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All proxy tiers failed');
}

module.exports = { fetchWithProxy };
