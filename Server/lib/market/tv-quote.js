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
  // no_404=true: unknown symbols return HTTP 200 with a null body. Treat that as a
  // definitive empty quote (not a throw) so symbol-health can classify as "missing"
  // rather than a transient provider outage ("unknown"), which never flags.
  if (data === null || typeof data !== 'object') {
    const empty = { close: null };
    cacheSet(symbol, empty);
    return empty;
  }

  cacheSet(symbol, data);
  return data;
}

// Fundamentals + identifiers the chart/quote endpoints don't carry. The TradingView
// scanner serves these auth-free: market cap, shares outstanding, 30d average volume,
// ISIN and CUSIP (CUSIP is null for non-North-American listings, e.g. ASX).
const FUND_FIELDS = [
  'market_cap_basic', 'total_shares_outstanding', 'average_volume_30d_calc',
  'isin', 'cusip', 'currency', 'fundamental_currency_code',
].join(',');

const fundCache = new Map();

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function fetchTvFundamentals(symbol) {
  if (!symbol) return null;
  const e = fundCache.get(symbol);
  if (e && Date.now() - e.ts < CACHE_TTL_MS) return e.data;

  const url = `${TV_BASE}?symbol=${encodeURIComponent(symbol)}&fields=${encodeURIComponent(FUND_FIELDS)}&no_404=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TV ${res.status} for ${symbol}`);
  const data = await res.json();
  if (data === null || typeof data !== 'object') return null;

  const out = {
    market_cap: numOrNull(data.market_cap_basic),
    market_cap_currency: data.fundamental_currency_code || null,
    shares_outstanding: numOrNull(data.total_shares_outstanding),
    avg_volume_30d: numOrNull(data.average_volume_30d_calc),
    isin: data.isin || null,
    cusip: data.cusip || null,
    currency: data.currency || null,
  };
  fundCache.set(symbol, { ts: Date.now(), data: out });
  return out;
}

module.exports = { fetchTvQuote, fetchTvFundamentals, tvSymbolForCompany };
