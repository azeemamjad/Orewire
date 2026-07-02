const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const {
  fetchCompanyQuote,
  fetchListQuote,
  yahooSymbolForCompany,
  tvSymbolForCompany,
} = require('../../lib/market-quote');
const { fetchYahooHistory } = require('../../lib/yahoo-quote');
const {
  normalizePrice,
  COMMODITY_SYMBOLS,
  INDEX_SYMBOLS,
  CURRENCY_SYMBOLS,
  commodityConfig,
  buildCommodityItem,
  getCommoditiesPayload,
  getIndexesPayload,
  getCurrenciesPayload,
} = require('../../lib/market/payloads');
const {
  getMoversCached,
  setMoversCached,
  clearMoversCache,
} = require('../../lib/market/movers-cache');
const { listSymbols } = require('../../lib/market/instrument-symbols-store');
const { fetchTvQuote } = require('../../lib/market/tv-quote');
const { isTvSymbolHealthy } = require('../../lib/market/symbol-health');

// Market data is sourced from Yahoo Finance with a TradingView fallback (see
// lib/market-quote). The function keeps its historical name and (exchange,
// ticker) signature so the company quote / movers / batch routes need no
// changes; it returns the same TradingView-shaped fields normalizePrice() reads.
async function fetchTradingView(exchange, ticker) {
  return fetchCompanyQuote(exchange, ticker);
}

// GET /api/market/quote?symbol=TSX:TECK.B — TV symbol query (live header polling)
router.get('/quote', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim();
  if (!symbol) return res.status(400).json({ error: 'symbol query param required' });

  const empty = {
    price: null,
    change_pct: null,
    change_abs: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    currency: null,
    tv_symbol: symbol,
    source: 'tradingview',
    unavailable: true,
    updatedAt: new Date().toISOString(),
  };

  try {
    const data = await fetchTvQuote(symbol);
    if (!data || data.close == null) return res.json(empty);
    const norm = normalizePrice(data);
    res.json({
      ...norm,
      tv_symbol: symbol,
      source: 'tradingview',
      unavailable: false,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    res.json(empty);
  }
});

// GET /api/market/symbol-health?symbol=TSX:TECK
router.get('/symbol-health', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const healthy = await isTvSymbolHealthy(symbol);
    res.json({ symbol, healthy });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/market/instruments/:type/:key/symbols
router.get('/instruments/:type/:key/symbols', async (req, res) => {
  try {
    const type = String(req.params.type || '').toLowerCase();
    const key = req.params.key;
    if (!['company', 'commodity', 'currency', 'index'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    let items;
    if (type === 'company') {
      const companyId = parseInt(key, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'Company key must be numeric id' });
      items = await listSymbols('company', { entityId: companyId });
    } else {
      items = await listSymbols(type, { entityKey: key });
    }
    res.json({ items });
  } catch (err) {
    console.error('Instrument symbols fetch failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// GET /api/market/quote/:exchange/:ticker
router.get('/quote/:exchange/:ticker', async (req, res) => {
  try {
    const data = await fetchTradingView(req.params.exchange, req.params.ticker);
    res.json(normalizePrice(data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/market/batch?symbols=TSXV:SCZ,ASX:DEG,TSXV:NFG
router.get('/batch', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (symbols.length === 0) return res.status(400).json({ error: 'symbols query param required (comma-separated)' });

  const results = {};
  await Promise.all(symbols.map(async (sym) => {
    const [exchange, ticker] = sym.split(':');
    if (!exchange || !ticker) {
      results[sym] = { error: 'Invalid format, use EXCHANGE:TICKER' };
      return;
    }
    try {
      const data = await fetchTradingView(exchange, ticker);
      results[sym] = normalizePrice(data);
    } catch (err) {
      results[sym] = { error: err.message };
    }
  }));

  res.json(results);
});

// GET /api/market/movers?exchange=TSXV&limit=10
// exchange=ALL  -> top gainers/losers across all quoted companies in DB
router.get('/movers', async (req, res) => {
  try {
  const exchange = (req.query.exchange || 'ALL').toUpperCase();
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
  const cacheKey = `${exchange}:${limit}`;
  const cached = getMoversCached(cacheKey);
  if (cached) return res.json(cached);

  const { buildMoversPayload } = require('../../lib/company-quote-refresh');
  const fromDb = await buildMoversPayload(exchange, limit);

  if (fromDb.quotedCount > 0) {
    const result = {
      exchange: fromDb.exchange,
      updatedAt: fromDb.updatedAt,
      gainers: fromDb.gainers,
      losers: fromDb.losers,
    };
    setMoversCached(cacheKey, result);
    return res.json(result);
  }

  // Fallback until the first background refresh completes.
  const result = await fetchMoversLiveSample(exchange, limit);
  setMoversCached(cacheKey, result);
  res.json(result);
  } catch (err) {
    console.error('Movers query failed:', err?.message || err);
    res.status(503).json({ exchange: 'ALL', updatedAt: new Date().toISOString(), gainers: [], losers: [] });
  }
});

/** Legacy live-sample movers — used only when no stored quotes exist yet. */
async function fetchMoversLiveSample(exchange, limit) {
  let companies;
  if (exchange === 'ALL') {
    const sampleSize = Math.max(40, limit * 6);
    const r = await db.query(
      `SELECT DISTINCT ON (ticker, exchange) ticker, name, exchange, market_cap, shares_outstanding
         FROM companies
        WHERE ticker IS NOT NULL
          AND exchange IN ('TSXV','TSX','CSE','ASX')
        ORDER BY ticker, exchange, market_cap DESC NULLS LAST
        LIMIT $1`,
      [sampleSize]
    );
    companies = r.rows;
    companies.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
    companies = companies.slice(0, sampleSize);
  } else {
    const r = await db.query(
      `SELECT DISTINCT ON (ticker, exchange) ticker, name, exchange, market_cap, shares_outstanding
         FROM companies
        WHERE ticker IS NOT NULL AND exchange = $1
        ORDER BY ticker, exchange, market_cap DESC NULLS LAST
        LIMIT $2`,
      [exchange, Math.max(20, limit * 4)]
    );
    companies = r.rows;
  }

  const gainers = [];
  const losers = [];

  await Promise.all(companies.map(async (c) => {
    try {
      const data = await fetchTradingView(c.exchange, c.ticker);
      const norm = normalizePrice(data);
      if (norm.price === null || norm.change_pct === null) return;
      const sharesOut = Number(c.shares_outstanding);
      const computedMcap = norm.price != null && Number.isFinite(sharesOut) && sharesOut > 0
        ? norm.price * sharesOut
        : null;
      const item = {
        ticker: c.ticker,
        name: c.name,
        exchange: c.exchange,
        price: norm.price,
        change_pct: norm.change_pct,
        market_cap: computedMcap ?? c.market_cap ?? null,
        volume: norm.volume,
        perf_ytd: norm.perf_ytd,
      };
      if (norm.change_pct > 0) gainers.push(item);
      else if (norm.change_pct < 0) losers.push(item);
    } catch { /* ignore failed lookups */ }
  }));

  gainers.sort((a, b) => b.change_pct - a.change_pct);
  losers.sort((a, b) => a.change_pct - b.change_pct);

  return {
    exchange,
    updatedAt: new Date().toISOString(),
    gainers: gainers.slice(0, limit),
    losers: losers.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Commodities, indexes, currencies
// ---------------------------------------------------------------------------

router.get('/commodities', async (_req, res) => {
  try {
    res.json(await getCommoditiesPayload());
  } catch (err) {
    console.error('Commodities query failed:', err?.message || err);
    res.status(503).json({ updatedAt: new Date().toISOString(), items: [] });
  }
});

// GET /api/market/commodities/:key — full quote (TradingView-first for detail pages)
router.get('/commodities/:key/history', async (req, res) => {
  try {
    const c = commodityConfig(req.params.key);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const range = String(req.query.range || '3M').toUpperCase();
    const sym = c.y[0];
    if (!sym) return res.json({ range, symbol: null, points: [] });
    const points = await fetchYahooHistory(sym, range);
    res.json({ range, symbol: sym, points });
  } catch (err) {
    console.error('Commodity history failed:', err?.message || err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/commodities/:key', async (req, res) => {
  try {
    const c = commodityConfig(req.params.key);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const item = await buildCommodityItem(c, { preferTv: true });
    res.json({ updatedAt: new Date().toISOString(), ...item });
  } catch (err) {
    console.error('Commodity detail failed:', err?.message || err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/indexes', async (_req, res) => {
  try {
    res.json(await getIndexesPayload());
  } catch (err) {
    console.error('Indexes query failed:', err?.message || err);
    res.status(503).json({ updatedAt: new Date().toISOString(), items: [] });
  }
});

router.get('/currencies', async (_req, res) => {
  try {
    res.json(await getCurrenciesPayload());
  } catch (err) {
    console.error('Currencies query failed:', err?.message || err);
    res.status(503).json({ updatedAt: new Date().toISOString(), items: [] });
  }
});

// ---------------------------------------------------------------------------
// Lightweight intraday history (24h, 30m snapshots)
// ---------------------------------------------------------------------------
const HISTORY_INTERVAL_MS = 30 * 60 * 1000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const historyCache = new Map();

function pushHistoryPoint(symbol, norm) {
  const now = Date.now();
  const existing = historyCache.get(symbol) || { points: [], lastFetchTs: 0 };
  const point = {
    ts: now,
    open: norm.open ?? norm.price ?? null,
    high: norm.high ?? norm.price ?? null,
    low: norm.low ?? norm.price ?? null,
    close: norm.price ?? null,
    volume: norm.volume ?? null,
  };
  const points = existing.points
    .filter((p) => now - p.ts <= HISTORY_WINDOW_MS)
    .concat(point);
  historyCache.set(symbol, { points, lastFetchTs: now });
}

/** Resolve a (kind, key) pair to Yahoo + TradingView fallback symbol lists. */
function resolveQuoteSymbols(kind, key, exchange) {
  const upperKey = (key || '').toUpperCase();
  if (kind === 'company') {
    const y = yahooSymbolForCompany(exchange, upperKey);
    const tv = tvSymbolForCompany(exchange, upperKey);
    return { y: y ? [y] : [], tv: tv ? [tv] : [] };
  }
  const lists = { commodity: COMMODITY_SYMBOLS, currency: CURRENCY_SYMBOLS, index: INDEX_SYMBOLS };
  const list = lists[kind];
  if (!list) return null;
  const c = list.find((x) => x.key.toUpperCase() === upperKey);
  if (!c) return null;
  return { y: c.y || [], tv: c.tv || [] };
}

// GET /api/market/history/:kind/:key?exchange=TSXV
// kind: company | commodity | currency | index
router.get('/history/:kind/:key', async (req, res) => {
  try {
    const kind = (req.params.kind || '').toLowerCase();
    const key = req.params.key;
    const exchange = req.query.exchange || '';
    const syms = resolveQuoteSymbols(kind, key, exchange);
    if (!syms || (!syms.y.length && !syms.tv.length)) {
      return res.status(400).json({ error: 'Unsupported history symbol' });
    }

    const cacheId = `${kind}:${(key || '').toUpperCase()}:${(exchange || '').toUpperCase()}`;
    const existing = historyCache.get(cacheId);
    const now = Date.now();
    const shouldRefresh = !existing || now - existing.lastFetchTs >= HISTORY_INTERVAL_MS;

    let usedSymbol = existing?.symbol || null;
    if (shouldRefresh) {
      const r = await fetchListQuote(syms.y, syms.tv);
      if (r) {
        usedSymbol = r.symbol;
        pushHistoryPoint(cacheId, normalizePrice(r.quote));
        const e = historyCache.get(cacheId);
        if (e) e.symbol = usedSymbol;
      } else if (!existing) {
        return res.status(502).json({ error: 'No market data for symbol', points: [] });
      }
    }

    const latest = historyCache.get(cacheId) || { points: [] };
    const points = latest.points.filter((p) => now - p.ts <= HISTORY_WINDOW_MS);
    historyCache.set(cacheId, { ...latest, points });

    res.json({
      kind,
      key,
      symbol: usedSymbol,
      intervalMs: HISTORY_INTERVAL_MS,
      windowMs: HISTORY_WINDOW_MS,
      points,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to fetch history', points: [] });
  }
});

module.exports = router;
module.exports.getCommoditiesPayload = getCommoditiesPayload;
module.exports.getIndexesPayload = getIndexesPayload;
module.exports.getCurrenciesPayload = getCurrenciesPayload;
module.exports.clearMoversCache = clearMoversCache;
