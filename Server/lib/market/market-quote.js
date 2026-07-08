/**
 * Unified market-quote source: Yahoo Finance first, TradingView as fallback.
 *
 * Every quote returned uses the TradingView-scanner field shape (close / change
 * / change_abs / Perf.* / price_52_week_high / fundamental_currency_code / …),
 * so callers (routes/market.js, routes/companies.js) and normalizePrice() work
 * the same regardless of which provider answered.
 *
 * Charts on the frontend are independent of this module.
 */

const { fetchYahooQuote, fetchYahooByExchange, yahooSymbolForCompany } = require('./yahoo-quote');
const { fetchTvQuote, tvSymbolForCompany } = require('./tv-quote');
const { fetchMetalsLiveQuote, metalsLiveSupported } = require('./metals-live-quote');

function hasPrice(q) {
  return q && q.close != null;
}

/**
 * Company lookup by OreWire exchange + ticker.
 *
 * Default: Yahoo first, TradingView fallback (movers refresh, snapshots, etc.).
 * opts.preferTv: TradingView first, Yahoo fallback (company detail — matches chart).
 *
 * Returns the first quote that carries a price; if neither has one it returns
 * whatever object came back (so the caller can still surface currency/identity
 * fields) and only throws when both providers fail outright.
 */
async function fetchCompanyQuote(exchange, ticker, opts = {}) {
  const { preferTv = false, ...quoteOpts } = opts;
  let yahoo = null;
  let firstErr = null;
  const tvSym = tvSymbolForCompany(exchange, ticker);

  async function tryTv() {
    if (!tvSym) return null;
    try {
      const tv = await fetchTvQuote(tvSym);
      if (hasPrice(tv)) return { ...tv, _source: 'tradingview' };
    } catch (err) {
      firstErr = firstErr || err;
    }
    return null;
  }

  if (preferTv) {
    const tv = await tryTv();
    if (tv) return tv;
  }

  try {
    yahoo = await fetchYahooByExchange(exchange, ticker, quoteOpts);
  } catch (err) {
    firstErr = firstErr || err;
  }
  if (hasPrice(yahoo)) return yahoo;

  if (!preferTv) {
    const tv = await tryTv();
    if (tv) return tv;
  }

  if (yahoo) return yahoo; // valid object, just no price
  throw firstErr || new Error('No quote available');
}

/**
 * List lookup (commodity / index / currency). Tries each Yahoo symbol in order,
 * then each TradingView symbol. Returns { quote, symbol } for the first with a
 * price, or null if none resolved.
 */
async function fetchListQuote(yahooSymbols = [], tvSymbols = [], opts = {}) {
  const { preferTv = false, metalsLiveKey = null } = opts;

  async function tryMetalsLive() {
    if (!metalsLiveKey || !metalsLiveSupported(metalsLiveKey)) return null;
    try {
      const q = await fetchMetalsLiveQuote(metalsLiveKey);
      if (hasPrice(q)) return { quote: q, symbol: `metals.live:${metalsLiveKey}`, provider: 'metals.live' };
    } catch { /* fall through */ }
    return null;
  }

  async function tryYahoo() {
    for (const s of yahooSymbols) {
      try {
        const q = await fetchYahooQuote(s);
        if (hasPrice(q)) return { quote: q, symbol: s, provider: 'yahoo' };
      } catch { /* try next */ }
    }
    return null;
  }

  async function tryTv() {
    for (const s of tvSymbols) {
      try {
        const q = await fetchTvQuote(s);
        if (hasPrice(q)) return { quote: q, symbol: s, provider: 'tradingview' };
      } catch { /* try next */ }
    }
    return null;
  }

  if (preferTv) {
    const tv = await tryTv();
    if (tv) return tv;
    const ml = await tryMetalsLive();
    if (ml) return ml;
    return tryYahoo();
  }

  const yh = await tryYahoo();
  if (yh) return yh;
  const ml = await tryMetalsLive();
  if (ml) return ml;
  return tryTv();
}

module.exports = {
  fetchCompanyQuote,
  fetchListQuote,
  yahooSymbolForCompany,
  tvSymbolForCompany,
};
