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

function hasPrice(q) {
  return q && q.close != null;
}

/**
 * Company lookup by OreWire exchange + ticker. Tries Yahoo, then TradingView.
 * Returns the first quote that carries a price; if neither has one it returns
 * whatever object came back (so the caller can still surface currency/identity
 * fields) and only throws when both providers fail outright.
 */
async function fetchCompanyQuote(exchange, ticker, opts) {
  let yahoo = null;
  let firstErr = null;
  try {
    yahoo = await fetchYahooByExchange(exchange, ticker, opts);
  } catch (err) {
    firstErr = err;
  }
  if (hasPrice(yahoo)) return yahoo;

  const tvSym = tvSymbolForCompany(exchange, ticker);
  if (tvSym) {
    try {
      const tv = await fetchTvQuote(tvSym);
      if (hasPrice(tv)) return tv;
    } catch (err) {
      firstErr = firstErr || err;
    }
  }

  if (yahoo) return yahoo; // valid object, just no price
  throw firstErr || new Error('No quote available');
}

/**
 * List lookup (commodity / index / currency). Tries each Yahoo symbol in order,
 * then each TradingView symbol. Returns { quote, symbol } for the first with a
 * price, or null if none resolved.
 */
async function fetchListQuote(yahooSymbols = [], tvSymbols = []) {
  for (const s of yahooSymbols) {
    try {
      const q = await fetchYahooQuote(s);
      if (hasPrice(q)) return { quote: q, symbol: s };
    } catch { /* try next */ }
  }
  for (const s of tvSymbols) {
    try {
      const q = await fetchTvQuote(s);
      if (hasPrice(q)) return { quote: q, symbol: s };
    } catch { /* try next */ }
  }
  return null;
}

module.exports = {
  fetchCompanyQuote,
  fetchListQuote,
  yahooSymbolForCompany,
  tvSymbolForCompany,
};
