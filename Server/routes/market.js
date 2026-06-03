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
  { key: 'gold',      label: 'Gold',            unit: 'oz',  tv: ['COMEX:GC1!', 'TVC:GOLD', 'OANDA:XAUUSD'] },
  { key: 'silver',    label: 'Silver',          unit: 'oz',  tv: ['COMEX:SI1!', 'TVC:SILVER', 'OANDA:XAGUSD'] },
  { key: 'copper',    label: 'Copper',          unit: 'lb',  tv: ['COMEX:HG1!', 'TVC:COPPER', 'CAPITALCOM:COPPER'] },
  { key: 'uranium',   label: 'Uranium',         unit: 'lb',  tv: ['NYMEX:UX1!', 'AMEX:URA', 'NYSEARCA:URA'] },
  { key: 'lithium',   label: 'Lithium',         unit: 't',   tv: ['TVC:LITHIUM', 'AMEX:LIT', 'NYSEARCA:LIT'] },
  { key: 'iron_ore',  label: 'Iron Ore',        unit: 't',   tv: ['TVC:IRONORE', 'SGX:FEF1!', 'NYMEX:TIO1!'] },
  { key: 'nickel',    label: 'Nickel',          unit: 't',   tv: ['LME:NI1!', 'SHFE:NI1!', 'NYMEX:LN1!', 'TVC:NICKEL'] },
  { key: 'zinc',      label: 'Zinc',            unit: 't',   tv: ['LME:ZN1!', 'SHFE:ZN1!'] },
  { key: 'brent',     label: 'Brent Crude Oil', unit: 'bbl', tv: ['NYMEX:BB1!', 'TVC:UKOIL', 'ICEEUR:BRN1!'] },
  { key: 'wti',       label: 'WTI Crude Oil',   unit: 'bbl', tv: ['NYMEX:CL1!', 'TVC:USOIL', 'CAPITALCOM:OIL_CRUDE'] },
  { key: 'tin',       label: 'Tin',             unit: 't',   tv: ['LME:SN1!'] },
  { key: 'cobalt',    label: 'Cobalt',          unit: 't',   tv: ['LME:CA1!'] },
  { key: 'lead',      label: 'Lead',            unit: 't',   tv: ['LME:PB1!', 'SHFE:PB1!'] },
  { key: 'platinum',  label: 'Platinum',        unit: 'oz',  tv: ['NYMEX:PL1!', 'TVC:PLATINUM', 'OANDA:XPTUSD'] },
  { key: 'palladium', label: 'Palladium',       unit: 'oz',  tv: ['NYMEX:PA1!', 'TVC:PALLADIUM', 'OANDA:XPDUSD'] },
];

const COMMODITY_CACHE_TTL_MS = 30 * 60 * 1000;
let commoditiesCache = null;
let commoditiesCacheTs = 0;

async function getCommoditiesPayload() {
  if (commoditiesCache && Date.now() - commoditiesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return commoditiesCache;
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
  return payload;
}

router.get('/commodities', async (_req, res) => {
  try {
    res.json(await getCommoditiesPayload());
  } catch (err) {
    console.error('Commodities query failed:', err?.message || err);
    res.status(503).json({ updatedAt: new Date().toISOString(), items: [] });
  }
});

// ---------------------------------------------------------------------------
// Indexes (Mining & Markets via TradingView)
// ---------------------------------------------------------------------------

const INDEX_SYMBOLS = [
  { key: 'GDXJ', label: 'Junior Gold Miners ETF',   tv: ['AMEX:GDXJ', 'NYSEARCA:GDXJ'],          about: 'Junior gold miners ETF — small and mid-cap gold producers and explorers.' },
  { key: 'TSXV', label: 'TSX Venture Composite',    tv: ['TSX:JX', 'TSX:TSXV', 'INDEX:JX'],      about: 'Composite benchmark of TSX Venture Exchange listings — heavily weighted to junior mining and exploration issuers in Canada.' },
  { key: 'XMM',  label: 'ASX 300 Metals & Mining',  tv: ['ASX:XMM', 'INDEX:XMM', 'ASX:MVR'],     about: 'S&P/ASX 300 Metals & Mining Index — Australian-listed mining and metals producers. Live price proxied via ASX:MVR (VanEck Australian Resources ETF) when the index OHLC is unavailable.' },
  { key: 'GDX',  label: 'Gold Miners ETF',          tv: ['AMEX:GDX', 'NYSEARCA:GDX'],            about: 'Large-cap gold miners ETF — tracks NYSE Arca Gold Miners Index.' },
  { key: 'XGD',  label: 'S&P/TSX Gold Index',       tv: ['TSX:XGD', 'INDEX:XGD'],                about: 'S&P/TSX Gold Index — Canadian-listed gold producers.' },
  { key: 'URA',  label: 'Uranium Miners ETF',       tv: ['AMEX:URA', 'NYSEARCA:URA'],            about: 'Uranium miners and nuclear fuel ETF.' },
  { key: 'COPX', label: 'Copper Miners ETF',        tv: ['AMEX:COPX', 'NYSEARCA:COPX'],          about: 'Global copper miners ETF — pure-play exposure to copper producers worldwide.' },
  { key: 'SIL',  label: 'Silver Miners ETF',        tv: ['AMEX:SIL', 'NYSEARCA:SIL'],            about: 'Global X Silver Miners ETF — primary-silver producers worldwide.' },
  { key: 'LIT',  label: 'Lithium & Battery ETF',    tv: ['AMEX:LIT', 'NYSEARCA:LIT'],            about: 'Lithium miners and battery manufacturers ETF.' },
  { key: 'PICK', label: 'Metal & Mining SPDR ETF',  tv: ['CBOE:PICK', 'AMEX:PICK', 'NYSEARCA:PICK'], about: 'iShares MSCI Global Metals & Mining Producers ETF.' },
  { key: 'TSX',  label: 'S&P/TSX Composite',        tv: ['TSX:TSX', 'INDEX:TSX'],                about: 'S&P/TSX Composite Index — the benchmark for the Toronto Stock Exchange covering large-cap Canadian equities.' },
  { key: 'XJO',  label: 'ASX 200',                  tv: ['ASX:XJO', 'INDEX:XJO'],                about: 'S&P/ASX 200 — Australian large-cap benchmark.' },
  { key: 'SPX',  label: 'S&P 500',                  tv: ['SP:SPX', 'TVC:SPX', 'INDEX:SPX'],      about: 'S&P 500 — US large-cap benchmark.' },
  { key: 'VIX',  label: 'Volatility Index',         tv: ['TVC:VIX', 'CBOE:VIX', 'INDEX:VIX'],    about: 'CBOE Volatility Index — implied 30-day S&P 500 volatility.' },
];

let indexesCache = null;
let indexesCacheTs = 0;

async function getIndexesPayload() {
  if (indexesCache && Date.now() - indexesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return indexesCache;
  }
  const items = await Promise.all(INDEX_SYMBOLS.map(async (c) => {
    for (const sym of c.tv) {
      try {
        const [ex, tick] = sym.split(':');
        const data = await fetchTradingView(ex, tick);
        const norm = normalizePrice(data);
        if (norm.price == null) continue;
        return { key: c.key, label: c.label, about: c.about, price: norm.price, change_pct: norm.change_pct, currency: norm.currency };
      } catch { /* try next */ }
    }
    return { key: c.key, label: c.label, about: c.about, price: null, change_pct: null, currency: null };
  }));
  const payload = { updatedAt: new Date().toISOString(), items };
  indexesCache = payload;
  indexesCacheTs = Date.now();
  return payload;
}

router.get('/indexes', async (_req, res) => {
  try {
    res.json(await getIndexesPayload());
  } catch (err) {
    console.error('Indexes query failed:', err?.message || err);
    res.status(503).json({ updatedAt: new Date().toISOString(), items: [] });
  }
});

// ---------------------------------------------------------------------------
// Currencies (FX spot via TradingView)
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = [
  { key: 'AUDCAD', label: 'AUD / CAD', tv: ['FX:AUDCAD', 'FX_IDC:AUDCAD', 'OANDA:AUDCAD'] },
  { key: 'USDCAD', label: 'USD / CAD', tv: ['FX:USDCAD', 'FX_IDC:USDCAD', 'OANDA:USDCAD'] },
  { key: 'AUDUSD', label: 'AUD / USD', tv: ['FX:AUDUSD', 'FX_IDC:AUDUSD', 'OANDA:AUDUSD'] },
  { key: 'DXY',    label: 'DXY',       tv: ['TVC:DXY', 'INDEX:DXY'], subtitle: 'US Dollar Index' },
];

let currenciesCache = null;
let currenciesCacheTs = 0;

async function getCurrenciesPayload() {
  if (currenciesCache && Date.now() - currenciesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return currenciesCache;
  }
  const items = await Promise.all(CURRENCY_SYMBOLS.map(async (c) => {
    for (const sym of c.tv) {
      try {
        const [ex, tick] = sym.split(':');
        const data = await fetchTradingView(ex, tick);
        const norm = normalizePrice(data);
        if (norm.price == null) continue;
        return {
          key: c.key,
          label: c.label,
          subtitle: c.subtitle || null,
          price: norm.price,
          change_pct: norm.change_pct,
        };
      } catch {
        // try next fallback
      }
    }
    return { key: c.key, label: c.label, subtitle: c.subtitle || null, price: null, change_pct: null };
  }));
  const payload = { updatedAt: new Date().toISOString(), items };
  currenciesCache = payload;
  currenciesCacheTs = Date.now();
  return payload;
}

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

function historyKey(exchange, ticker) {
  return `${exchange.toUpperCase()}:${ticker.toUpperCase()}`;
}

function pushHistoryPoint(exchange, ticker, norm) {
  const key = historyKey(exchange, ticker);
  const now = Date.now();
  const existing = historyCache.get(key) || { points: [], lastFetchTs: 0 };
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
  historyCache.set(key, { points, lastFetchTs: now });
}

function resolveTvSymbol(kind, key, exchange) {
  const upperKey = (key || '').toUpperCase();
  if (kind === 'company') {
    const ex = (exchange || '').toUpperCase().replace('-', '');
    if (!ex || !upperKey) return null;
    return { exchange: ex, ticker: upperKey };
  }
  if (kind === 'commodity') {
    const c = COMMODITY_SYMBOLS.find((x) => x.key.toUpperCase() === upperKey);
    if (!c || !c.tv?.length) return null;
    const [ex, tick] = c.tv[0].split(':');
    return { exchange: ex, ticker: tick };
  }
  if (kind === 'currency') {
    const c = CURRENCY_SYMBOLS.find((x) => x.key.toUpperCase() === upperKey);
    if (!c || !c.tv?.length) return null;
    const [ex, tick] = c.tv[0].split(':');
    return { exchange: ex, ticker: tick };
  }
  if (kind === 'index') {
    const c = INDEX_SYMBOLS.find((x) => x.key.toUpperCase() === upperKey);
    if (!c || !c.tv?.length) return null;
    const [ex, tick] = c.tv[0].split(':');
    return { exchange: ex, ticker: tick };
  }
  return null;
}

// GET /api/market/history/:kind/:key?exchange=TSXV
// kind: company | commodity | currency | index
router.get('/history/:kind/:key', async (req, res) => {
  try {
    const kind = (req.params.kind || '').toLowerCase();
    const key = req.params.key;
    const exchange = req.query.exchange || '';
    const resolved = resolveTvSymbol(kind, key, exchange);
    if (!resolved) return res.status(400).json({ error: 'Unsupported history symbol' });

    const hKey = historyKey(resolved.exchange, resolved.ticker);
    const existing = historyCache.get(hKey);
    const now = Date.now();
    const shouldRefresh = !existing || now - existing.lastFetchTs >= HISTORY_INTERVAL_MS;

    if (shouldRefresh) {
      try {
        const data = await fetchTradingView(resolved.exchange, resolved.ticker);
        const norm = normalizePrice(data);
        pushHistoryPoint(resolved.exchange, resolved.ticker, norm);
      } catch (err) {
        // If we have older cached points, still return them.
        if (!existing) throw err;
      }
    }

    const latest = historyCache.get(hKey) || { points: [] };
    const points = latest.points.filter((p) => now - p.ts <= HISTORY_WINDOW_MS);
    historyCache.set(hKey, { ...latest, points });

    res.json({
      kind,
      key,
      exchange: resolved.exchange,
      ticker: resolved.ticker,
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
