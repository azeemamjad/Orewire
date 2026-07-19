/**
 * Web-search orchestrator.
 *
 * Prefers the Brave Search API (reliable JSON, not IP-gated) when
 * BRAVE_SEARCH_API_KEY is configured, and falls back to the DuckDuckGo scraper
 * (VQD JSON → token-free HTML endpoints, through the proxy pool) when Brave is
 * unconfigured, errors, or returns nothing.
 *
 * Callers should require this module, not the individual backends.
 */
const { braveSearch, isBraveEnabled } = require('./brave');
const { searchDuckDuckGo } = require('./duckduckgo');

/**
 * @param {string} query
 * @param {object} [opts]  forwarded to the backend ({ limit, ... })
 * @returns {Promise<Array<{title:string, url:string, snippet:string}>>}
 */
async function searchWeb(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  if (isBraveEnabled()) {
    try {
      const results = await braveSearch(q, opts);
      if (results.length) return results;
      // Brave returned no results (rare) — try DDG before giving up.
    } catch (err) {
      console.warn(`[websearch] Brave failed, falling back to DuckDuckGo: ${err.message}`);
    }
  }

  return searchDuckDuckGo(q, opts);
}

module.exports = { searchWeb };
