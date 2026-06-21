const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { attachUser } = require('./auth');

function normalizeExchange(ex) {
  if (!ex) return null;
  const upper = ex.toUpperCase();
  if (upper === 'TSX-V') return 'TSXV';
  if (upper === 'TSXV') return 'TSXV';
  return upper;
}

const { fetchCompanyQuote } = require('../lib/market-quote');
const { fetchTvFundamentals, tvSymbolForCompany } = require('../lib/tv-quote');
const {
  COMMODITY_KEYS,
  CONTINENT_KEYS,
  safeParse,
  deriveCommodities,
  deriveContinents,
  deriveCountry,
} = require('../lib/company-enrich');

// Company market data comes from Yahoo Finance, falling back to TradingView when
// Yahoo has no price (see lib/market-quote). The returned object keeps the
// TradingView-scanner field names this route reads (close/change/change_abs/
// Perf.*/price_52_week_high/…). When the Yahoo path answers, the fields its
// chart endpoint can't supply (sector/country/description/Recommend.All) are
// null; the TradingView fallback fills them in.
async function fetchTvSymbol(exchange, ticker) {
  // history:true → also pull 52-week high/low (shown in the detail Key stats).
  return fetchCompanyQuote(exchange, ticker, { history: true });
}

// ---------------------------------------------------------------------------
// raw_data parsing / derived fields
// ---------------------------------------------------------------------------

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

// GET /api/companies?page=1&limit=20&search=&exchange=&commodity=&continent=&country=&missing=
// `missing` filters to companies lacking enrichment data:
//   description | website | headquarters | people | any
router.get('/', async (req, res) => {
  try {
  const { search, exchange, commodity, continent, country, missing, page = '1', limit = '20' } = req.query;
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

  if (missing) {
    const noPeople = `NOT EXISTS (SELECT 1 FROM company_people p WHERE p.company_id = companies.id)`;
    const checks = {
      description:    `(description IS NULL OR description = '')`,
      website:        `(website IS NULL OR website = '')`,
      headquarters:   `(headquarters IS NULL OR headquarters = '')`,
      transfer_agent: `(transfer_agent IS NULL OR transfer_agent = '')`,
      people:         noPeople,
    };
    if (missing === 'any') {
      where.push(`(${[checks.description, checks.website, checks.headquarters, checks.transfer_agent, checks.people].join(' OR ')})`);
    } else if (checks[missing]) {
      where.push(checks[missing]);
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countQuery = `SELECT COUNT(*) as c FROM companies ${whereSql}`;
  const countResult = await db.query(countQuery, params);
  const total = parseInt(countResult.rows[0].c, 10);

  const dataParams = [...params, limitNum, offset];
  const dataQuery = `
    SELECT companies.*,
           EXISTS (SELECT 1 FROM company_people p WHERE p.company_id = companies.id) AS has_people
    FROM companies
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
  } catch (err) {
    console.error('Companies list query failed:', err?.message || err);
    res.status(503).json({
      error: err?.message || 'Database unavailable',
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
  }
});

router.get('/exchanges', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT DISTINCT exchange FROM companies WHERE exchange IS NOT NULL ORDER BY exchange'
    );
    res.json(result.rows.map(r => r.exchange));
  } catch (err) {
    console.error('Exchanges query failed:', err?.message || err);
    res.status(503).json([]);
  }
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

// POST /api/companies — admin: add a new company manually
function strOrNull(v) {
  const s = (v ?? '').toString().trim();
  return s || null;
}
function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function boolFlag(v) {
  return (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
}

function _normalizePerson(body) {
  return {
    name: (body?.name || '').trim(),
    title: body?.title ? String(body.title).trim() : null,
    kind: body?.kind === 'director' ? 'director' : 'manager',
  };
}

async function upsertCompanyPerson(companyId, body) {
  const p = _normalizePerson(body);
  if (!p.name) return null;
  const r = await db.query(
    `INSERT INTO company_people (company_id, name, role_code, title, age, since_year, kind, source, updated_at)
     VALUES ($1, $2, NULL, $3, NULL, NULL, $4, 'manual', NOW())
     ON CONFLICT (company_id, name, kind) DO UPDATE SET
       title      = EXCLUDED.title,
       source     = 'manual',
       updated_at = NOW()
     RETURNING id, name, role_code, title, age, since_year, kind, source, updated_at`,
    [companyId, p.name, p.title, p.kind]
  );
  return r.rows[0];
}

router.post('/', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const name = strOrNull(body.name);
    const ticker = strOrNull(body.ticker)?.toUpperCase();
    const exchange = normalizeExchange(strOrNull(body.exchange));
    const sedar_ticker = strOrNull(body.sedar_ticker)?.toUpperCase() || null;

    if (!name) return res.status(400).json({ error: 'Company name is required' });
    if (!ticker) return res.status(400).json({ error: 'Ticker is required' });
    if (!exchange) return res.status(400).json({ error: 'Exchange is required (e.g. TSXV, CSE, ASX, TSX)' });

    const dup = await db.query(
      'SELECT id FROM companies WHERE UPPER(ticker) = $1 AND exchange = $2 LIMIT 1',
      [ticker, exchange]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `Company ${exchange}:${ticker} already exists` });
    }

    const fields = {
      market_cap: numOrNull(body.market_cap),
      total_float: numOrNull(body.total_float),
      sector: strOrNull(body.sector),
      listing_date: strOrNull(body.listing_date),
      region: strOrNull(body.region),
      has_gold: boolFlag(body.has_gold),
      has_silver: boolFlag(body.has_silver),
      has_copper: boolFlag(body.has_copper),
      description: strOrNull(body.description),
      website: strOrNull(body.website),
      headquarters: strOrNull(body.headquarters),
      transfer_agent: strOrNull(body.transfer_agent),
      phone: strOrNull(body.phone),
      shares_outstanding: intOrNull(body.shares_outstanding),
      ms_slug: strOrNull(body.ms_slug),
      profile_source: strOrNull(body.profile_source) || 'manual',
    };

    const r = await db.query(
      `INSERT INTO companies (
         name, ticker, exchange, sedar_ticker,
         market_cap, total_float, sector, listing_date, region,
         has_gold, has_silver, has_copper,
         description, website, headquarters, transfer_agent, phone,
         shares_outstanding, ms_slug, profile_source, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15, $16, $17,
         $18, $19, $20, NOW()
       )
       RETURNING *`,
      [
        name, ticker, exchange, sedar_ticker,
        fields.market_cap, fields.total_float, fields.sector, fields.listing_date, fields.region,
        fields.has_gold, fields.has_silver, fields.has_copper,
        fields.description, fields.website, fields.headquarters, fields.transfer_agent, fields.phone,
        fields.shares_outstanding, fields.ms_slug, fields.profile_source,
      ]
    );
    const companyId = r.rows[0].id;
    const peopleIn = Array.isArray(body.people) ? body.people : [];
    const people = [];
    for (const raw of peopleIn) {
      const row = await upsertCompanyPerson(companyId, raw);
      if (row) people.push(row);
    }
    res.status(201).json({ ...enrichCompany(r.rows[0]), people });
  } catch (err) {
    console.error('Company create failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

// GET /api/companies/:idOrSlug  — accepts numeric ID or "EXCHANGE-TICKER" slug (e.g. "TSXV-SCZ")
router.get('/:idOrSlug', async (req, res) => {
  try {
  const param = req.params.idOrSlug;
  let result;

  if (/^\d+$/.test(param)) {
    result = await db.query('SELECT * FROM companies WHERE id = $1', [param]);
  } else {
    const dashIdx = param.indexOf('-');
    if (dashIdx > 0) {
      const exchange = normalizeExchange(param.slice(0, dashIdx));
      const ticker = param.slice(dashIdx + 1).toUpperCase();
      result = await db.query(
        'SELECT * FROM companies WHERE exchange = $1 AND UPPER(ticker) = $2 LIMIT 1',
        [exchange, ticker]
      );
      if (result.rows.length === 0) {
        result = await db.query(
          'SELECT * FROM companies WHERE UPPER(ticker) = $1 LIMIT 1',
          [ticker]
        );
      }
    } else {
      result = await db.query(
        'SELECT * FROM companies WHERE UPPER(ticker) = $1 LIMIT 1',
        [param.toUpperCase()]
      );
    }
  }

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

  // Fundamentals + identifiers (market cap, shares out, 30d avg volume, ISIN, CUSIP)
  // from the TradingView scanner — neither the Yahoo chart nor the price quote carry them.
  let fundamentals = null;
  if (row.ticker && row.exchange) {
    try {
      fundamentals = await fetchTvFundamentals(tvSymbolForCompany(row.exchange, row.ticker));
    } catch {
      fundamentals = null;
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
  `, [row.id, row.name]);

  const enriched = enrichCompany(row);
  // eslint-disable-next-line no-unused-vars
  const { raw_data, ...clean } = enriched;
  res.json({ ...clean, marketData, fundamentals, filings: filingsResult.rows });
  } catch (err) {
    console.error('Company detail query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Company delete failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// ---------------------------------------------------------------------------
// Admin enrichment: read + edit profile (description / website / HQ) + people
// ---------------------------------------------------------------------------

// GET /api/companies/:id/profile — current enrichment fields + people list
router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const c = await db.query(
      `SELECT id, exchange, ticker, name, description, website, headquarters,
              transfer_agent, phone, shares_outstanding, profile_source,
              ms_slug, profile_scraped_at
       FROM companies WHERE id = $1`,
      [id]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const p = await db.query(
      `SELECT id, name, role_code, title, age, since_year, kind, source, updated_at
       FROM company_people WHERE company_id = $1
       ORDER BY CASE kind WHEN 'manager' THEN 0 ELSE 1 END, role_code NULLS LAST, name`,
      [id]
    );
    res.json({ company: c.rows[0], people: p.rows });
  } catch (err) {
    console.error('Profile read failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// PUT /api/companies/:id/profile — update description / website / headquarters
router.put('/:id/profile', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { description, website, headquarters, transfer_agent, phone } = req.body || {};
    const r = await db.query(
      `UPDATE companies SET
         description        = $2,
         website            = $3,
         headquarters       = $4,
         transfer_agent     = $5,
         phone              = $6,
         profile_scraped_at = COALESCE(profile_scraped_at, NOW()),
         updated_at         = NOW()
       WHERE id = $1
       RETURNING id, description, website, headquarters, transfer_agent, phone`,
      [id, description ?? null, website ?? null, headquarters ?? null, transfer_agent ?? null, phone ?? null]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Profile update failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// POST /api/companies/:id/people — add a person
router.post('/:id/people', express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const p = _normalizePerson(req.body);
    if (!p.name) return res.status(400).json({ error: 'name required' });
    const exists = await db.query('SELECT 1 FROM companies WHERE id = $1', [id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    const row = await upsertCompanyPerson(id, req.body);
    res.json(row);
  } catch (err) {
    console.error('Person add failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

// PUT /api/companies/:id/people/:personId — update one person
router.put('/:id/people/:personId', express.json(), async (req, res) => {
  try {
    const { id, personId } = req.params;
    const p = _normalizePerson(req.body);
    if (!p.name) return res.status(400).json({ error: 'name required' });
    const r = await db.query(
      `UPDATE company_people SET
         name = $3, title = $4, kind = $5,
         source = 'manual', updated_at = NOW()
       WHERE id = $2 AND company_id = $1
       RETURNING id, name, role_code, title, age, since_year, kind, source, updated_at`,
      [id, personId, p.name, p.title, p.kind]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Person update failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

// DELETE /api/companies/:id/people/:personId — remove a person
router.delete('/:id/people/:personId', async (req, res) => {
  try {
    const { id, personId } = req.params;
    await db.query('DELETE FROM company_people WHERE id = $1 AND company_id = $2', [personId, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Person delete failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// GET /api/companies/:id/snapshot — AI situational brief (cached)
router.get('/:id/snapshot', async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });
    const exists = await db.query('SELECT 1 FROM companies WHERE id = $1', [companyId]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const { getCompanySnapshotView } = require('../lib/company-snapshot');
    const view = await getCompanySnapshotView(companyId, { force });
    if (view.status === 'empty') return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, status: view.status, needsRegen: view.needsRegen, snapshot: view.snapshot });
  } catch (err) {
    console.error('Company snapshot failed:', err?.message || err);
    res.status(503).json({ error: 'Snapshot unavailable' });
  }
});

// GET /api/companies/:id/insiders — ownership table + transaction feed.
// Free (anonymous) users see top 5 owners + latest 3 transactions; registered
// users (req.user set) see the full history.
router.get('/:id/insiders', attachUser, async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });
    const isRegistered = !!req.user;

    const ownershipRes = await db.query(
      `SELECT insider_name, title, total_shares, percent_ownership, last_transaction, last_transaction_date
         FROM insider_ownership
        WHERE company_id = $1
        ORDER BY COALESCE(percent_ownership, 0) DESC, COALESCE(total_shares, 0) DESC`,
      [companyId],
    );
    const txRes = await db.query(
      `SELECT insider_name, title, transaction_type, shares, price, transaction_date, total_holdings_after
         FROM insider_transactions
        WHERE company_id = $1
        ORDER BY transaction_date DESC NULLS LAST, id DESC
        LIMIT 200`,
      [companyId],
    );

    const ownershipAll = ownershipRes.rows;
    const txAll = txRes.rows;

    res.json({
      registered: isRegistered,
      ownershipTotal: ownershipAll.length,
      transactionsTotal: txAll.length,
      ownership: isRegistered ? ownershipAll : ownershipAll.slice(0, 5),
      transactions: isRegistered ? txAll : txAll.slice(0, 3),
    });
  } catch (err) {
    console.error('Insiders query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

module.exports = router;
