/**
 * TradingView scanner quote source — used ONLY as a fallback when Yahoo Finance
 * can't serve a symbol (see lib/market-quote). The raw scanner response already
 * uses the field names the rest of the codebase reads (close / change /
 * change_abs / Perf.* / price_52_week_high / …), so it is returned as-is.
 *
 * This is the data path only; it is unrelated to the TradingView embed charts
 * on the frontend.
 */

const TV_BASE = 'https://scanner.tradingview.com/symbol';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const FIELDS = [
  'close', 'open', 'high', 'low', 'volume',
  'change', 'change_abs',
  'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD',
  'sector', 'country', 'market', 'description', 'name',
  'Recommend.All', 'fundamental_currency_code',
  'price_52_week_high', 'price_52_week_low',
].join(',');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cacheGet(sym) {
  const e = cache.get(sym);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(sym);
    return null;
  }
  return e.data;
}

function cacheSet(sym, data) {
  cache.set(sym, { ts: Date.now(), data });
}

/** Map an OreWire exchange + ticker to a TradingView symbol (EXCHANGE:TICKER). */
function tvSymbolForCompany(exchange, ticker) {
  const ex = String(exchange || '').toUpperCase().replace('-', '');
  const t = String(ticker || '').toUpperCase().trim();
  if (!t) return null;
  return ex ? `${ex}:${t}` : t;
}

async function fetchTvQuote(symbol) {
  if (!symbol) throw new Error('No symbol');
  const cached = cacheGet(symbol);
  if (cached) return cached;

  const url = `${TV_BASE}?symbol=${encodeURIComponent(symbol)}&fields=${encodeURIComponent(FIELDS)}&no_404=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TV ${res.status} for ${symbol}`);
  const data = await res.json();
  if (data === null || typeof data !== 'object') throw new Error('TV returned null/empty');

  cacheSet(symbol, data);
  return data;
}

module.exports = { fetchTvQuote, tvSymbolForCompany };
