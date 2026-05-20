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

// GET /api/market/movers?exchange=TSXV&limit=10
router.get('/movers', async (req, res) => {
  const exchange = req.query.exchange || 'TSXV';
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);

  // Get distinct tickers for that exchange from our companies DB
  const companiesResult = await db.query(
    'SELECT DISTINCT ticker, name, exchange FROM companies WHERE exchange = $1 AND ticker IS NOT NULL LIMIT $2',
    [exchange, limit * 2]
  );
  const companies = companiesResult.rows;

  const results = { gainers: [], losers: [] };

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

      if (norm.change_pct > 0) results.gainers.push(item);
      else if (norm.change_pct < 0) results.losers.push(item);
    } catch { /* ignore failed lookups */ }
  }));

  results.gainers.sort((a, b) => b.change_pct - a.change_pct);
  results.losers.sort((a, b) => a.change_pct - b.change_pct);

  res.json({
    exchange,
    gainers: results.gainers.slice(0, limit),
    losers: results.losers.slice(0, limit),
  });
});

module.exports = router;
