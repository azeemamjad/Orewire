const express = require('express');
const router  = express.Router();
const db      = require('../db');

function normalizeExchange(ex) {
  if (!ex) return null;
  const upper = ex.toUpperCase();
  if (upper === 'TSX-V') return 'TSXV';
  if (upper === 'TSXV') return 'TSXV';
  return upper;
}

const TV_BASE = 'https://scanner.tradingview.com/symbol';
const tvCache = new Map();
const TV_CACHE_TTL = 5 * 60 * 1000;

function tvCacheGet(key) {
  const e = tvCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TV_CACHE_TTL) { tvCache.delete(key); return null; }
  return e.data;
}
function tvCacheSet(key, data) { tvCache.set(key, { ts: Date.now(), data }); }

async function fetchTvSymbol(exchange, ticker) {
  const sym = `${exchange.toUpperCase().replace('-', '')}:${ticker.toUpperCase()}`;
  const cached = tvCacheGet(sym);
  if (cached) return cached;
  const fields = 'close,open,high,low,volume,change,change_abs,sector,country,market,description,name,fundamental_currency_code,Perf.W,Perf.1M,Perf.3M,Perf.6M,Perf.Y,Perf.YTD,Recommend.All,price_52_week_high,price_52_week_low';
  const url = `${TV_BASE}?symbol=${encodeURIComponent(sym)}&fields=${encodeURIComponent(fields)}&no_404=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TV ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== 'object') throw new Error('TV null');
  tvCacheSet(sym, data);
  return data;
}

// GET /api/companies?page=1&limit=20&search=&exchange=
router.get('/', async (req, res) => {
  const { search, exchange, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let countQuery = 'SELECT COUNT(*) as c FROM companies WHERE 1=1';
  let dataQuery = 'SELECT * FROM companies WHERE 1=1';
  const params = [];
  const countParams = [];

  if (search) {
    const clause = ' AND (name ILIKE $1 OR ticker ILIKE $1 OR sedar_ticker ILIKE $1)';
    countQuery += clause;
    dataQuery += clause;
    const sp = `%${search}%`;
    params.push(sp);
    countParams.push(sp);
  }
  const normExchange = exchange ? normalizeExchange(exchange) : null;
  if (normExchange) {
    const clause = ` AND exchange = $${params.length + 1}`;
    countQuery += clause;
    dataQuery += clause;
    params.push(normExchange);
    countParams.push(normExchange);
  }

  dataQuery += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const countResult = await db.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].c, 10);
  const rowsResult = await db.query(dataQuery, params);
  const rows = rowsResult.rows;

  res.json({
    data: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasNext: pageNum * limitNum < total,
      hasPrev: pageNum > 1,
    }
  });
});

router.get('/exchanges', async (req, res) => {
  const result = await db.query(
    'SELECT DISTINCT exchange FROM companies WHERE exchange IS NOT NULL ORDER BY exchange'
  );
  res.json(result.rows.map(r => r.exchange));
});

// GET /api/companies/:id
router.get('/:id', async (req, res) => {
  const result = await db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Fetch market data from TradingView if ticker exists
  let marketData = null;
  if (row.ticker && row.exchange) {
    try {
      const tv = await fetchTvSymbol(row.exchange, row.ticker);
      marketData = {
        price: tv.close ?? null,
        change_pct: tv.change ?? null,
        change_abs: tv.change_abs ?? null,
        open: tv.open ?? null,
        high: tv.high ?? null,
        low: tv.low ?? null,
        volume: tv.volume ?? null,
        sector: tv.sector ?? row.sector ?? null,
        country: tv.country ?? null,
        description: tv.description ?? null,
        perf_week: tv['Perf.W'] ?? null,
        perf_month: tv['Perf.1M'] ?? null,
        perf_ytd: tv['Perf.YTD'] ?? null,
        perf_year: tv['Perf.Y'] ?? null,
        recommend: tv['Recommend.All'] ?? null,
        currency: tv.fundamental_currency_code ?? null,
        price_52_week_high: tv.price_52_week_high ?? null,
        price_52_week_low: tv.price_52_week_low ?? null,
      };
    } catch (err) {
      marketData = { error: err.message };
    }
  }

  // Get recent filings — match by company_id OR fuzzy company_name
  const filingsResult = await db.query(`
    SELECT f.id, f.filing_type, f.commodity, f.created_at, a.verdict, a.summary
    FROM filings f
    LEFT JOIN ai_output a ON a.filing_id = f.id
    WHERE f.company_id = $1
       OR TRIM(REPLACE(REPLACE(f.company_name, '.', ''), ',', '')) = TRIM(REPLACE(REPLACE($2, '.', ''), ',', ''))
    ORDER BY f.created_at DESC
    LIMIT 10
  `, [req.params.id, row.name]);

  res.json({ ...row, marketData, filings: filingsResult.rows });
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
