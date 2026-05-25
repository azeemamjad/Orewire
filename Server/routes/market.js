const express = require('express');
const router  = express.Router();
const db      = require('../db');

const TV_BASE = 'https://scanner.tradingview.com/symbol';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

const DEFAULT_FIELDS = [
  'close', 'open', 'high', 'low', 'volume',
  'change', 'change_abs',
  'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD',
  'sector', 'country', 'market', 'description', 'name',
  'Recommend.All', 'fundamental_currency_code',
];

function cacheKey(symbol) {
  return symbol.toUpperCase();
}

function getCached(symbol) {
  const key = cacheKey(symbol);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(symbol, data) {
  cache.set(cacheKey(symbol), { ts: Date.now(), data });
}

function tvSymbol(exchange, ticker) {
  const ex = exchange.toUpperCase().replace('-', '');
  const tick = ticker.toUpperCase();
  if (ex === 'TSX') return `TSX:${tick}`;
  if (ex === 'TSXV') return `TSXV:${tick}`;
  if (ex === 'CSE') return `CSE:${tick}`;
  if (ex === 'ASX') return `ASX:${tick}`;
  return `${ex}:${tick}`;
}

async function fetchTradingView(exchange, ticker) {
  const symbol = tvSymbol(exchange, ticker);
  const cached = getCached(symbol);
  if (cached) return cached;

  const fields = DEFAULT_FIELDS.join(',');
  const url = `${TV_BASE}?symbol=${encodeURIComponent(symbol)}&fields=${encodeURIComponent(fields)}&no_404=true`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`TV ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data === null || typeof data !== 'object') throw new Error('TV returned null/empty');

  setCached(symbol, data);
  return data;
}

function normalizePrice(data) {
  return {
    symbol: data.name || null,
    price: data.close ?? null,
    change_pct: data.change ?? null,
    change_abs: data.change_abs ?? null,
    open: data.open ?? null,
    high: data.high ?? null,
    low: data.low ?? null,
    volume: data.volume ?? null,
    sector: data.sector ?? null,
    country: data.country ?? null,
    description: data.description ?? null,
    perf_week: data['Perf.W'] ?? null,
    perf_month: data['Perf.1M'] ?? null,
    perf_ytd: data['Perf.YTD'] ?? null,
    perf_year: data['Perf.Y'] ?? null,
    recommend: data['Recommend.All'] ?? null,
    currency: data.fundamental_currency_code ?? null,
    raw: data,
  };
}

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

// Aggregated movers cache (30 minutes) — keyed by exchange query
const MOVERS_CACHE_TTL_MS = 30 * 60 * 1000;
const moversCache = new Map();

function getMoversCached(key) {
  const entry = moversCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > MOVERS_CACHE_TTL_MS) {
    moversCache.delete(key);
    return null;
  }
  return entry.data;
}
function setMoversCached(key, data) {
  moversCache.set(key, { ts: Date.now(), data });
}

// GET /api/market/movers?exchange=TSXV&limit=10
// exchange=ALL  -> aggregate across TSXV/TSX/CSE/ASX (sampled by market cap)
router.get('/movers', async (req, res) => {
  try {
  const exchange = (req.query.exchange || 'ALL').toUpperCase();
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
  const cacheKey = `${exchange}:${limit}`;
  const cached = getMoversCached(cacheKey);
  if (cached) return res.json(cached);

  // Pick the company sample
  let companies;
  if (exchange === 'ALL') {
    const sampleSize = Math.max(40, limit * 6);
    const r = await db.query(
      `SELECT DISTINCT ON (ticker, exchange) ticker, name, exchange, market_cap
         FROM companies
        WHERE ticker IS NOT NULL
          AND exchange IN ('TSXV','TSX','CSE','ASX')
        ORDER BY ticker, exchange, market_cap DESC NULLS LAST
        LIMIT $1`,
      [sampleSize]
    );
    companies = r.rows;
    // Re-order the sample to favor higher market cap names overall
    companies.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
    companies = companies.slice(0, sampleSize);
  } else {
    const r = await db.query(
      `SELECT DISTINCT ticker, name, exchange
         FROM companies
        WHERE ticker IS NOT NULL AND exchange = $1
        ORDER BY ticker
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
      const item = {
        ticker: c.ticker,
        name: c.name,
        exchange: c.exchange,
        price: norm.price,
        change_pct: norm.change_pct,
        volume: norm.volume,
        perf_ytd: norm.perf_ytd,
      };
      if (norm.change_pct > 0) gainers.push(item);
      else if (norm.change_pct < 0) losers.push(item);
    } catch { /* ignore failed lookups */ }
  }));

  gainers.sort((a, b) => b.change_pct - a.change_pct);
  losers.sort((a, b) => a.change_pct - b.change_pct);

  const result = {
    exchange,
    updatedAt: new Date().toISOString(),
    gainers: gainers.slice(0, limit),
    losers: losers.slice(0, limit),
  };
  setMoversCached(cacheKey, result);
  res.json(result);
  } catch (err) {
    console.error('Movers query failed:', err?.message || err);
    res.status(503).json({ exchange: 'ALL', updatedAt: new Date().toISOString(), gainers: [], losers: [] });
  }
});

// ---------------------------------------------------------------------------
// Commodities (TradingView spot / front-month futures)
// ---------------------------------------------------------------------------
// Each commodity has fallback symbols tried in order until one returns data.
const COMMODITY_SYMBOLS = [
  { key: 'gold',    label: 'Gold',     unit: 'oz', tv: ['TVC:GOLD', 'OANDA:XAUUSD'] },
  { key: 'silver',  label: 'Silver',   unit: 'oz', tv: ['TVC:SILVER', 'OANDA:XAGUSD'] },
  { key: 'copper',  label: 'Copper',   unit: 'lb', tv: ['COMEX:HG1!', 'TVC:COPPER', 'CAPITALCOM:COPPER'] },
  { key: 'lithium', label: 'Lithium',  unit: 'ETF', tv: ['AMEX:LIT', 'NASDAQ:LIT', 'NYSEARCA:LIT'] },
  { key: 'uranium', label: 'U₃O₈', unit: 'lb', tv: ['AMEX:URA', 'NYSEARCA:URA'] },
  { key: 'nickel',  label: 'Nickel',   unit: 't',  tv: ['SHFE:NI1!', 'NYMEX:LN1!', 'AMEX:NIKL', 'LME_DLY:N1!', 'TVC:NICKEL'] },
];

const COMMODITY_CACHE_TTL_MS = 30 * 60 * 1000;
let commoditiesCache = null;
let commoditiesCacheTs = 0;

router.get('/commodities', async (_req, res) => {
  if (commoditiesCache && Date.now() - commoditiesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return res.json(commoditiesCache);
  }
  const items = await Promise.all(COMMODITY_SYMBOLS.map(async (c) => {
    for (const sym of c.tv) {
      try {
        const [ex, tick] = sym.split(':');
        const data = await fetchTradingView(ex, tick);
        const norm = normalizePrice(data);
        if (norm.price == null) continue;
        return {
          key: c.key,
          label: c.label,
          unit: c.unit,
          price: norm.price,
          change_pct: norm.change_pct,
          source: sym,
        };
      } catch {
        // try next fallback
      }
    }
    return { key: c.key, label: c.label, unit: c.unit, price: null, change_pct: null, source: null };
  }));
  const payload = { updatedAt: new Date().toISOString(), items };
  commoditiesCache = payload;
  commoditiesCacheTs = Date.now();
  res.json(payload);
});

module.exports = router;
