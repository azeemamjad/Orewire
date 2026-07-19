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

// Transport for the token-free HTML fallback below. `needle` is already present
// (duck-duck-scrape depends on it) and supports proxies the same way, so the
// fallback behaves consistently with the primary path. If it can't be required,
// the fallback still works for direct (non-proxied) requests via global fetch.
let needle = null;
try { needle = require('needle'); } catch { /* direct-only fallback via fetch */ }

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

// ── Token-free HTML fallback ────────────────────────────────────────────────
// duck-duck-scrape must first fetch a VQD token from duckduckgo.com; when that
// fetch is blocked or rate-limited ("Failed to get the VQD"), the JSON API is
// unusable. DDG's HTML and Lite endpoints return plain HTML with NO token
// required, so we scrape those as a fallback (through the same proxy tiers).

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Both accept a form POST of `q=…`; POST is markedly more reliable than GET
// against these endpoints (GET frequently returns the 202 anomaly page).
const HTML_ENDPOINTS = [
  'https://html.duckduckgo.com/html/',
  'https://lite.duckduckgo.com/lite/',
];

// DDG result links are wrapped as //duckduckgo.com/l/?uddg=<encoded target>.
function decodeDdgHref(href) {
  if (!href) return '';
  const h = href.startsWith('//') ? `https:${href}` : href;
  try {
    const uddg = new URL(h).searchParams.get('uddg');
    return uddg || h;
  } catch {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    return m ? decodeURIComponent(m[1]) : href;
  }
}

function parseHtmlResults(html, limit) {
  const anchorRe = /<a[^>]+class="[^"]*(?:result__a|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));
  const results = [];
  let m;
  let i = 0;
  while ((m = anchorRe.exec(html)) !== null && results.length < limit) {
    const url = decodeDdgHref(m[1]);
    const title = stripTags(m[2]);
    if (url && /^https?:\/\//.test(url) && !/(?:^|\/\/)(?:[^/]*\.)?duckduckgo\.com/.test(url)) {
      results.push({ title, url, snippet: snippets[i] || '' });
    }
    i += 1;
  }
  return results;
}

function httpPostForm(url, form, proxyUrl) {
  const headers = { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (needle) {
    return new Promise((resolve, reject) => {
      const opts = {
        headers,
        follow_max: 3,
        open_timeout: 15000,
        response_timeout: 15000,
        read_timeout: 15000,
        compressed: true,
      };
      if (proxyUrl) opts.proxy = proxyUrl;
      needle.post(url, form, opts, (err, resp) => {
        if (err) return reject(err);
        if (!resp || resp.statusCode >= 400 || resp.statusCode === 202) {
          return reject(new Error(`HTTP ${resp ? resp.statusCode : '?'}`));
        }
        resolve(typeof resp.body === 'string' ? resp.body : String(resp.body || ''));
      });
    });
  }
  if (proxyUrl) return Promise.reject(new Error('proxied fallback requires needle'));
  return fetch(url, { method: 'POST', headers, body: form }).then((r) => {
    if (!r.ok || r.status === 202) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

/** Scrape DDG's token-free HTML/Lite endpoints. Returns [] if reached but empty. */
async function searchHtmlFallback(query, limit, proxyUrl) {
  const form = `q=${encodeURIComponent(query)}&kl=us-en`;
  let lastErr;
  let reached = false;
  for (const url of HTML_ENDPOINTS) {
    try {
      const html = await httpPostForm(url, form, proxyUrl);
      reached = true;
      const results = parseHtmlResults(html, limit);
      if (results.length) return results;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!reached && lastErr) throw lastErr;
  return [];
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

  // Primary: duck-duck-scrape (structured JSON, needs a VQD token).
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

  // Fallback: token-free HTML endpoints (no VQD). Every primary transport threw
  // — most likely a VQD failure — so retry the same transports against the HTML
  // scraper before giving up.
  let fallbackReached = false;
  for (const proxyUrl of transports) {
    await throttle();
    try {
      const results = await searchHtmlFallback(q, limit, proxyUrl);
      fallbackReached = true;
      if (results.length) return results;
    } catch (err) {
      lastErr = err;
    }
  }
  if (fallbackReached) return []; // reached DDG but no parseable results
  throw lastErr || new Error('DuckDuckGo search failed');
}

// `searchDuckDuckGo` is the name the orchestrator (index.js) uses; `searchWeb`
// stays exported for backward compatibility with any direct importers.
module.exports = { searchWeb, searchDuckDuckGo: searchWeb };
