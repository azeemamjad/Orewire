/**
 * DuckDuckGo web search wrapper (uses the `duck-duck-scrape` library, which
 * handles the VQD token dance for us — no API key required).
 *
 * Robustness: DDG's anomaly detection frequently blocks datacenter IPs, so this
 * tries a direct request first and, on failure, falls back through the app's own
 * proxy pool (datacenter → residential) via needle's proxy option. It also
 * strips HTML from titles/snippets, throttles between calls, and retries with
 * backoff.
 */
const { search, SafeSearchType } = require('duck-duck-scrape');

const MIN_GAP_MS = Number(process.env.DDG_MIN_GAP_MS || 1200);
let lastCallAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function throttle() {
  const now = Date.now();
  const wait = lastCallAt + MIN_GAP_MS - now;
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function proxyUrlFromParts(server, username, password) {
  if (!server) return null;
  const hostPort = String(server).replace(/^\w+:\/\//, '');
  const cred = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password || '')}@`
    : '';
  return `http://${cred}${hostPort}`;
}

/** Ordered list of needle transports to try: direct first, then proxy tiers. */
async function buildTransports() {
  const transports = [null]; // direct
  if (process.env.DDG_USE_PROXY === 'false') return transports;
  try {
    // Lazy require so the search module doesn't drag in the proxy subsystem
    // unless proxies are actually used.
    const store = require('../../relay/proxy-store');
    if (!store.getCachedProxies().length) {
      try { await store.refreshProxyCache(); } catch { /* DB may be unavailable */ }
    }
    const enabled = store.getCachedProxies().filter((p) => p.enabled);
    const ordered = [
      ...enabled.filter((p) => p.tier === 'datacenter'),
      ...enabled.filter((p) => p.tier === 'residential'),
    ];
    for (const row of ordered) {
      const p = store.rowToPlaywrightProxy(row);
      const url = proxyUrlFromParts(p.server, p.username, p.password);
      if (url) transports.push(url);
    }
  } catch { /* no proxy pool — direct only */ }
  return transports;
}

async function searchOnce(query, limit, proxyUrl) {
  const needleOpts = proxyUrl ? { proxy: proxyUrl } : {};
  const res = await search(query, { safeSearch: SafeSearchType.OFF }, needleOpts);
  if (!res || res.noResults || !Array.isArray(res.results)) return [];
  return res.results
    .slice(0, limit)
    .map((r) => ({ title: stripTags(r.title), url: r.url, snippet: stripTags(r.description) }))
    .filter((r) => r.url);
}

/**
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=8]         max results to return
 * @param {number} [opts.retriesPerTransport=1]
 * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
 */
async function searchWeb(query, { limit = 8, retriesPerTransport = 1 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const transports = await buildTransports();
  let lastErr;
  for (const proxyUrl of transports) {
    for (let attempt = 0; attempt <= retriesPerTransport; attempt += 1) {
      await throttle();
      try {
        return await searchOnce(q, limit, proxyUrl);
      } catch (err) {
        lastErr = err;
        await sleep(800 * (attempt + 1));
      }
    }
  }
  throw lastErr || new Error('DuckDuckGo search failed');
}

module.exports = { searchWeb };
