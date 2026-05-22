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

// ---------------------------------------------------------------------------
// raw_data parsing / derived fields
// ---------------------------------------------------------------------------

// Commodity keys we surface (label → list of raw_data keys to OR together)
const COMMODITY_KEYS = {
  Gold:        ['Gold'],
  Silver:      ['Silver'],
  Copper:      ['Copper'],
  Lithium:     ['Lithium'],
  Nickel:      ['Nickel'],
  Uranium:     ['Uranium'],
  Zinc:        ['Zinc'],
  Cobalt:      ['Cobalt'],
  'Rare Earths': ['Rare Earths'],
};

// Continent label → raw_data column name
const CONTINENT_KEYS = {
  Africa:          'AFRICA',
  'North America': null,           // OR of CANADA / USA
  'South America': 'LATIN AMERICA',
  Australia:       'AUS/NZ/PNG',
  Asia:            'ASIA',
  Europe:          'UK/EUROPE',
};

function safeParse(json) {
  if (!json) return null;
  try { return typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
}

function deriveCommodities(row, raw) {
  const out = [];
  if (row.has_gold)    out.push('Gold');
  if (row.has_silver)  out.push('Silver');
  if (row.has_copper)  out.push('Copper');
  if (raw) {
    for (const [label, keys] of Object.entries(COMMODITY_KEYS)) {
      if (out.includes(label)) continue;
      for (const k of keys) {
        if (raw[k] && String(raw[k]).toUpperCase() === 'Y') { out.push(label); break; }
      }
    }
  }
  return Array.from(new Set(out));
}

function deriveContinents(raw) {
  if (!raw) return [];
  const out = [];
  if (raw['AFRICA'])         out.push('Africa');
  if (raw['ASIA'])           out.push('Asia');
  if (raw['AUS/NZ/PNG'])     out.push('Australia');
  if (raw['LATIN AMERICA'])  out.push('South America');
  if (raw['UK/EUROPE'])      out.push('Europe');
  if (raw['USA'] || raw['CANADA']) out.push('North America');
  return Array.from(new Set(out));
}

function deriveCountry(raw) {
  if (!raw) return null;
  // Specific country columns first
  const pieces = [];
  for (const col of ['AFRICA','ASIA','AUS/NZ/PNG','LATIN AMERICA','UK/EUROPE','OTHER']) {
    if (raw[col]) pieces.push(String(raw[col]));
  }
  if (raw['CANADA']) pieces.push('Canada');
  if (raw['USA'])    pieces.push('USA');
  // De-dupe + truncate
  const set = Array.from(new Set(pieces.flatMap(s => s.split(/[,;]/).map(x => x.trim()).filter(Boolean))));
  return set.length ? set.slice(0, 2).join(', ') : null;
}

function deriveStatus(row) {
  // We don't have explicit status; default Trading if market_cap > 0, else 'Listed'
  if (row.market_cap && row.market_cap > 0) return 'Trading';
  return 'Listed';
}

function enrichCompany(row) {
  const raw = safeParse(row.raw_data);
  return {
    ...row,
    commodities: deriveCommodities(row, raw),
    continents:  deriveContinents(raw),
    country:     deriveCountry(raw),
    status:      deriveStatus(row),
  };
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

// Build a WHERE clause that filters by commodity (matches either has_X column or raw_data JSON key)
function commodityClause(commodity, paramIdx) {
  if (!commodity || !COMMODITY_KEYS[commodity]) return null;
  const keys = COMMODITY_KEYS[commodity];
  const flagMap = { Gold: 'has_gold', Silver: 'has_silver', Copper: 'has_copper' };
  const flagCol = flagMap[commodity];
  const jsonChecks = keys.map(() => `(raw_data::jsonb->>$${paramIdx}) IN ('Y','y','TRUE','true','1')`).join(' OR ');
  const params = keys.map(k => k);
  const flagPart = flagCol ? `${flagCol} = 1 OR ` : '';
  return { sql: `(${flagPart}${jsonChecks})`, params };
}

function continentClause(continent, paramIdx) {
  if (!continent) return null;
  if (continent === 'North America') {
    return { sql: `( (raw_data::jsonb->>'CANADA') IS NOT NULL OR (raw_data::jsonb->>'USA') IS NOT NULL )`, params: [] };
  }
  const col = CONTINENT_KEYS[continent];
  if (!col) return null;
  return { sql: `(raw_data::jsonb->>$${paramIdx}) IS NOT NULL`, params: [col] };
}

function countryClause(country, paramIdx) {
  if (!country) return null;
  if (country === 'Canada') {
    return { sql: `(raw_data::jsonb->>'CANADA') IS NOT NULL`, params: [] };
  }
  if (country === 'USA') {
    return { sql: `(raw_data::jsonb->>'USA') IS NOT NULL`, params: [] };
  }
  const cols = ['AFRICA','ASIA','AUS/NZ/PNG','LATIN AMERICA','UK/EUROPE','OTHER'];
  const parts = cols.map(() => `(raw_data::jsonb->>$${paramIdx}) ILIKE $${paramIdx + 1}`);
  // PG doesn't let us reuse params per OR branch without repeating placeholders; build manually:
  // Simpler: use one $pat param and array_position approach via jsonb_each_text
  // But simplest portable: just expand all column→ILIKE pairs in JS
  const params = [];
  const sqlParts = [];
  let idx = paramIdx;
  for (const c of cols) {
    sqlParts.push(`(raw_data::jsonb->>$${idx}) ILIKE $${idx + 1}`);
    params.push(c, `%${country}%`);
    idx += 2;
  }
  return { sql: `(${sqlParts.join(' OR ')})`, params };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/companies?page=1&limit=20&search=&exchange=&commodity=&continent=&country=
router.get('/', async (req, res) => {
  const { search, exchange, commodity, continent, country, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const where = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR ticker ILIKE $${params.length} OR sedar_ticker ILIKE $${params.length})`);
  }
  const normExchange = exchange ? normalizeExchange(exchange) : null;
  if (normExchange) {
    params.push(normExchange);
    where.push(`exchange = $${params.length}`);
  }

  const commCl = commodityClause(commodity, params.length + 1);
  if (commCl) { where.push(commCl.sql); params.push(...commCl.params); }

  const contCl = continentClause(continent, params.length + 1);
  if (contCl) { where.push(contCl.sql); params.push(...contCl.params); }

  const cntryCl = countryClause(country, params.length + 1);
  if (cntryCl) { where.push(cntryCl.sql); params.push(...cntryCl.params); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countQuery = `SELECT COUNT(*) as c FROM companies ${whereSql}`;
  const countResult = await db.query(countQuery, params);
  const total = parseInt(countResult.rows[0].c, 10);

  const dataParams = [...params, limitNum, offset];
  const dataQuery = `
    SELECT * FROM companies
    ${whereSql}
    ORDER BY market_cap DESC NULLS LAST, name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const rowsResult = await db.query(dataQuery, dataParams);
  const rows = rowsResult.rows.map(enrichCompany).map(r => {
    // Strip raw_data from response to keep it small
    const { raw_data, ...rest } = r;
    return rest;
  });

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

router.get('/exchanges', async (_req, res) => {
  const result = await db.query(
    'SELECT DISTINCT exchange FROM companies WHERE exchange IS NOT NULL ORDER BY exchange'
  );
  res.json(result.rows.map(r => r.exchange));
});

// Available filter options derived from the data — used to render the sidebar.
router.get('/filters', async (_req, res) => {
  res.json({
    markets:    ['TSX-V', 'CSE', 'ASX', 'TSX'],
    commodities: Object.keys(COMMODITY_KEYS),
    continents: ['Africa', 'North America', 'South America', 'Australia', 'Asia', 'Europe'],
    countries: [
      'Argentina','Australia','Bolivia','Brazil','Burkina Faso','Canada','Chile','DRC','Guinea',
      'Mali','Mexico','Namibia','Papua New Guinea','Senegal','South Africa','Turkey','USA',
      'Zambia','Zimbabwe',
    ],
    statuses:   ['Trading', 'Halted', 'Upcoming', 'Delisted'],
  });
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

  const filingsResult = await db.query(`
    SELECT f.id, f.filing_type, f.commodity, f.created_at, a.verdict, a.summary
    FROM filings f
    LEFT JOIN ai_output a ON a.filing_id = f.id
    WHERE f.company_id = $1
       OR TRIM(REPLACE(REPLACE(f.company_name, '.', ''), ',', '')) = TRIM(REPLACE(REPLACE($2, '.', ''), ',', ''))
    ORDER BY f.created_at DESC
    LIMIT 10
  `, [req.params.id, row.name]);

  const enriched = enrichCompany(row);
  // eslint-disable-next-line no-unused-vars
  const { raw_data, ...clean } = enriched;
  res.json({ ...clean, marketData, filings: filingsResult.rows });
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
