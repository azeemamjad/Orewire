/**
 * Yahoo Finance quote source for OreWire market data.
 *
 * Replaces the TradingView scanner as the *data* provider for company /
 * commodity / index / currency detail pages. The TradingView embed charts on
 * the frontend are unaffected — those build their own symbol and load the
 * widget directly in the browser.
 *
 * We use the public v8 chart endpoint (no auth/crumb required) with a 1y daily
 * range so we can derive: live price, day OHLCV, day change, 52-week high/low,
 * and trailing performance (week / 1M / 3M / 6M / 1Y / YTD).
 *
 * The returned object intentionally mirrors the TradingView scanner field names
 * (`close`, `change`, `change_abs`, `Perf.W`, `fundamental_currency_code`,
 * `price_52_week_high`, …) so existing callers in market.js / companies.js keep
 * working with minimal change. Fields Yahoo's chart endpoint does not provide
 * (sector / country / description / analyst recommendation) are returned null.
 */

const YH_BASES = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

/** Map an OreWire exchange + ticker to a Yahoo Finance symbol. */
function yahooSymbolForCompany(exchange, ticker) {
  const ex = String(exchange || '').toUpperCase().replace('-', '');
  const t = String(ticker || '').toUpperCase().trim();
  if (!t) return null;
  const suffix = { TSX: '.TO', TSXV: '.V', CSE: '.CN', ASX: '.AX' }[ex];
  return suffix ? `${t}${suffix}` : t;
}

async function fetchChartResult(symbol, range) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  let lastErr;
  for (const base of YH_BASES) {
    try {
      const res = await fetch(base + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!res.ok) {
        lastErr = new Error(`Yahoo ${res.status} for ${symbol}`);
        continue;
      }
      const json = await res.json();
      if (json?.chart?.error) {
        lastErr = new Error(`Yahoo: ${json.chart.error.description || 'error'}`);
        continue;
      }
      const result = json?.chart?.result?.[0];
      if (!result) {
        lastErr = new Error(`Yahoo returned no data for ${symbol}`);
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Yahoo fetch failed for ${symbol}`);
}

/** Nearest non-null close at or before `idx`. */
function closeAtOrBefore(closes, idx) {
  for (let i = Math.min(idx, closes.length - 1); i >= 0; i--) {
    if (closes[i] != null) return closes[i];
  }
  return null;
}

/** Index of the last timestamp <= targetMs (timestamps are ascending). */
function indexAtOrBefore(timestamps, targetMs) {
  let idx = -1;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] * 1000 <= targetMs) idx = i;
    else break;
  }
  return idx;
}

function perfOverDays(timestamps, closes, latestPrice, daysAgo) {
  if (!timestamps.length || latestPrice == null) return null;
  const idx = indexAtOrBefore(timestamps, Date.now() - daysAgo * 86_400_000);
  const past = closeAtOrBefore(closes, idx >= 0 ? idx : 0);
  if (past == null || past === 0) return null;
  return ((latestPrice - past) / past) * 100;
}

function perfYtd(timestamps, closes, latestPrice) {
  if (!timestamps.length || latestPrice == null) return null;
  const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
  const idx = indexAtOrBefore(timestamps, jan1);
  const base = closeAtOrBefore(closes, idx >= 0 ? idx : 0);
  if (base == null || base === 0) return null;
  return ((latestPrice - base) / base) * 100;
}

/**
 * Fetch a single Yahoo symbol and normalize to the TradingView-scanner field
 * shape used across the codebase.
 *
 * Price + day change + day OHLCV come from a range=1d request, where
 * meta.chartPreviousClose is the *prior session* close — the only range that
 * yields a correct daily change (a 1y range returns a year-old previous close,
 * and an illiquid name's gappy daily series gives a wildly wrong "day change").
 *
 * @param {object} [opts]
 * @param {boolean} [opts.history] also fetch the 1y daily series for trailing
 *   performance and 52-week high/low (needed by the company detail page).
 */
async function fetchYahooQuote(symbol, { history = false } = {}) {
  if (!symbol) throw new Error('No symbol');
  const cacheKey = `${symbol}|${history ? 'h' : 'q'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const day = await fetchChartResult(symbol, '1d');
  const meta = day.meta || {};
  const dayQ = (day.indicators && day.indicators.quote && day.indicators.quote[0]) || {};
  const dayCloses = dayQ.close || [];

  const price = meta.regularMarketPrice ?? closeAtOrBefore(dayCloses, dayCloses.length - 1);
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const changeAbs = price != null && prevClose != null ? price - prevClose : null;
  const changePct = changeAbs != null && prevClose ? (changeAbs / prevClose) * 100 : null;

  const lastIdx = dayCloses.length - 1;
  const open = meta.regularMarketOpen ?? (dayQ.open ? dayQ.open[lastIdx] : null) ?? null;
  const high = meta.regularMarketDayHigh ?? (dayQ.high ? dayQ.high[lastIdx] : null) ?? null;
  const low = meta.regularMarketDayLow ?? (dayQ.low ? dayQ.low[lastIdx] : null) ?? null;
  const volume = meta.regularMarketVolume ?? (dayQ.volume ? dayQ.volume[lastIdx] : null) ?? null;

  let high52 = meta.fiftyTwoWeekHigh ?? null;
  let low52 = meta.fiftyTwoWeekLow ?? null;
  const perf = { W: null, M1: null, M3: null, M6: null, Y: null, YTD: null };

  if (history) {
    try {
      const yr = await fetchChartResult(symbol, '1y');
      const ts = yr.timestamp || [];
      const yq = (yr.indicators && yr.indicators.quote && yr.indicators.quote[0]) || {};
      const closes = yq.close || [];
      if (high52 == null || low52 == null) {
        const highs = (yq.high || []).filter((v) => v != null);
        const lows = (yq.low || []).filter((v) => v != null);
        if (high52 == null && highs.length) high52 = Math.max(...highs);
        if (low52 == null && lows.length) low52 = Math.min(...lows);
      }
      perf.W = perfOverDays(ts, closes, price, 7);
      perf.M1 = perfOverDays(ts, closes, price, 30);
      perf.M3 = perfOverDays(ts, closes, price, 91);
      perf.M6 = perfOverDays(ts, closes, price, 182);
      perf.Y = perfOverDays(ts, closes, price, 365);
      perf.YTD = perfYtd(ts, closes, price);
    } catch {
      /* keep nulls — daily snapshot is still valid */
    }
  }

  const out = {
    name: meta.symbol || symbol,
    close: price ?? null,
    open,
    high,
    low,
    volume,
    // TradingView semantics: `change` is the PERCENT change, `change_abs` the absolute.
    change: changePct,
    change_abs: changeAbs,
    fundamental_currency_code: meta.currency || null,
    price_52_week_high: high52,
    price_52_week_low: low52,
    'Perf.W': perf.W,
    'Perf.1M': perf.M1,
    'Perf.3M': perf.M3,
    'Perf.6M': perf.M6,
    'Perf.Y': perf.Y,
    'Perf.YTD': perf.YTD,
    // Not available from the Yahoo chart endpoint:
    sector: null,
    country: null,
    description: null,
    market: meta.exchangeName || null,
    'Recommend.All': null,
    _source: 'yahoo',
  };

  cacheSet(cacheKey, out);
  return out;
}

/** Company-style lookup by OreWire exchange + ticker. */
async function fetchYahooByExchange(exchange, ticker, opts) {
  const sym = yahooSymbolForCompany(exchange, ticker);
  if (!sym) throw new Error('Invalid exchange/ticker');
  return fetchYahooQuote(sym, opts);
}

module.exports = {
  yahooSymbolForCompany,
  fetchYahooQuote,
  fetchYahooByExchange,
};
