/**
 * Brave Search API backend — reliable JSON results, not IP-gated (unlike the
 * DuckDuckGo scraper). Enabled whenever BRAVE_SEARCH_API_KEY is set.
 *
 * Free tier is ~2,000 queries/month at 1 request/second, so we throttle. On any
 * API error we throw, letting the orchestrator fall back to DuckDuckGo.
 * Docs: https://brave.com/search/api/
 */
const API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MIN_GAP_MS = Number(process.env.BRAVE_MIN_GAP_MS || 1100);

let lastCallAt = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function throttle() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBraveEnabled() {
  return Boolean(API_KEY);
}

/**
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=8]
 * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
 * @throws when the API key is missing or the request fails (caller falls back).
 */
async function braveSearch(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (!API_KEY) throw new Error('BRAVE_SEARCH_API_KEY not set');

  await throttle();
  const count = Math.min(20, Math.max(1, limit));
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&count=${count}&country=us&search_lang=en`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': API_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brave HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();
  const results = data && data.web && Array.isArray(data.web.results) ? data.web.results : [];
  return results
    .slice(0, limit)
    .map((r) => ({ title: stripTags(r.title), url: r.url, snippet: stripTags(r.description) }))
    .filter((r) => r.url);
}

module.exports = { braveSearch, isBraveEnabled };
