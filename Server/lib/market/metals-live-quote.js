/**
 * metals.live spot pricing for base metals (zinc, tin, lead, cobalt).
 * Bulk endpoint: GET https://api.metals.live/v1/spot/commodities
 */

const METALS_LIVE_URL = 'https://api.metals.live/v1/spot/commodities';
const SUPPORTED_KEYS = new Set(['zinc', 'tin', 'lead', 'cobalt']);
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache = null;
let cacheTs = 0;

function normalizeSpotQuote(metalKey, price) {
  return {
    name: metalKey,
    close: price,
    change: null,
    change_abs: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    fundamental_currency_code: 'USD',
    _source: 'metals.live',
  };
}

async function fetchMetalsLiveCommodities() {
  if (cache && Date.now() - cacheTs < CACHE_TTL_MS) {
    return cache;
  }

  const res = await fetch(METALS_LIVE_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`metals.live HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('metals.live: unexpected response');

  const prices = {};
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const keys = Object.keys(entry);
    if (keys.length === 1 && keys[0] === 'timestamp') continue;
    for (const [name, price] of Object.entries(entry)) {
      if (name === 'timestamp') continue;
      if (typeof price === 'number' && Number.isFinite(price)) {
        prices[name.toLowerCase()] = price;
      }
    }
  }

  cache = prices;
  cacheTs = Date.now();
  return prices;
}

async function fetchMetalsLiveQuote(metalKey) {
  const key = String(metalKey || '').toLowerCase();
  if (!SUPPORTED_KEYS.has(key)) return null;

  try {
    const prices = await fetchMetalsLiveCommodities();
    const price = prices[key];
    if (price == null) return null;
    return normalizeSpotQuote(key, price);
  } catch {
    return null;
  }
}

function metalsLiveSupported(key) {
  return SUPPORTED_KEYS.has(String(key || '').toLowerCase());
}

module.exports = {
  fetchMetalsLiveQuote,
  fetchMetalsLiveCommodities,
  metalsLiveSupported,
  METALS_LIVE_SUPPORTED_KEYS: SUPPORTED_KEYS,
};
