/**
 * Free TradingView market-scanner movers for OreWire exchanges.
 *
 * Polls scanner.tradingview.com once per refresh (a few POSTs total), ranks
 * mining-sector stocks on TSX / TSXV / CSE / ASX, then keeps only tickers that
 * exist in our companies table so home-page links resolve.
 *
 * This is the upstream source for the shared /api/market/movers cache — browsers
 * never talk to TradingView; every user reads our cached payload.
 */
const db = require('../../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SCAN_URL = (market) => `https://scanner.tradingview.com/${market}/scan`;

const COLUMNS = [
  'name', 'description', 'exchange', 'close', 'change', 'change_abs',
  'volume', 'market_cap_basic', 'Perf.YTD', 'sector',
];

// Prefer resource/mining names so the board matches OreWire's audience.
const MINING_SECTORS = ['Non-Energy Minerals', 'Energy Minerals'];

const MARKET_SPECS = [
  { market: 'canada', exchanges: ['TSX', 'TSXV', 'CSE'] },
  { market: 'australia', exchanges: ['ASX'] },
];

// Pull a wide window from TV, then filter down to companies we actually list.
const SCAN_RANGE = 120;
const MIN_VOLUME = Math.max(0, parseInt(process.env.MOVERS_MIN_VOLUME || '1000', 10) || 1000);

function normalizeExchange(ex) {
  const u = String(ex || '').toUpperCase().replace(/-/g, '');
  if (u === 'TSXVENTURE' || u === 'TSXVENTUREEXCHANGE') return 'TSXV';
  return u;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function postScan(market, body) {
  const res = await fetch(SCAN_URL(market), {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TV scanner ${market} ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.data)) throw new Error(`TV scanner ${market} empty`);
  return data.data;
}

function rowToItem(row) {
  const d = row.d || [];
  const ticker = d[0] != null ? String(d[0]).toUpperCase() : null;
  const exchange = normalizeExchange(d[2]);
  const price = num(d[3]);
  const changePct = num(d[4]);
  if (!ticker || !exchange || price == null || changePct == null) return null;
  return {
    ticker,
    name: d[1] || ticker,
    exchange,
    price,
    change_pct: changePct,
    change_abs: num(d[5]),
    volume: num(d[6]),
    market_cap: num(d[7]),
    perf_ytd: num(d[8]),
    sector: d[9] || null,
    tv_symbol: row.s || `${exchange}:${ticker}`,
  };
}

async function scanSide(market, exchanges, sortOrder) {
  const body = {
    filter: [
      { left: 'type', operation: 'equal', right: 'stock' },
      { left: 'exchange', operation: 'in_range', right: exchanges },
      { left: 'sector', operation: 'in_range', right: MINING_SECTORS },
      { left: 'is_primary', operation: 'equal', right: true },
      { left: 'active_symbol', operation: 'equal', right: true },
      { left: 'volume', operation: 'greater', right: MIN_VOLUME },
    ],
    options: { lang: 'en' },
    markets: [market],
    columns: COLUMNS,
    sort: { sortBy: 'change', sortOrder },
    range: [0, SCAN_RANGE],
  };
  const rows = await postScan(market, body);
  return rows.map(rowToItem).filter(Boolean);
}

async function loadListedCompanyKeys() {
  const r = await db.query(
    `SELECT UPPER(exchange) AS exchange, UPPER(ticker) AS ticker, name,
            market_cap, shares_outstanding
       FROM companies
      WHERE ticker IS NOT NULL AND ticker <> ''
        AND exchange = ANY($1::text[])`,
    [['TSX', 'TSXV', 'CSE', 'ASX']],
  );
  const map = new Map();
  for (const row of r.rows) {
    const key = `${normalizeExchange(row.exchange)}:${String(row.ticker).toUpperCase()}`;
    map.set(key, row);
  }
  return map;
}

function attachListed(items, listed) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.exchange}:${item.ticker}`;
    if (seen.has(key)) continue;
    const co = listed.get(key);
    if (!co) continue; // only show names OreWire can open
    seen.add(key);
    const shares = Number(co.shares_outstanding);
    const mcap = item.price != null && Number.isFinite(shares) && shares > 0
      ? item.price * shares
      : (item.market_cap ?? co.market_cap ?? null);
    out.push({
      ticker: item.ticker,
      name: co.name || item.name,
      exchange: item.exchange,
      price: item.price,
      change_pct: item.change_pct,
      market_cap: mcap,
      volume: item.volume,
      perf_ytd: item.perf_ytd,
    });
  }
  return out;
}

/**
 * Fetch live movers from TradingView and filter to OreWire-listed companies.
 * @returns {{ exchange: string, updatedAt: string, gainers: object[], losers: object[], source: string }}
 */
async function fetchTvMovers({ limit = 10, exchange = 'ALL' } = {}) {
  const lim = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 50);
  const exFilter = String(exchange || 'ALL').toUpperCase();

  const specs = exFilter === 'ALL'
    ? MARKET_SPECS
    : MARKET_SPECS.filter((s) => s.exchanges.includes(exFilter));

  if (!specs.length) {
    return { exchange: exFilter, updatedAt: new Date().toISOString(), gainers: [], losers: [], source: 'tradingview' };
  }

  const [listed, ...sides] = await Promise.all([
    loadListedCompanyKeys(),
    ...specs.flatMap((s) => [
      scanSide(s.market, s.exchanges, 'desc'),
      scanSide(s.market, s.exchanges, 'asc'),
    ]),
  ]);

  let gainersRaw = [];
  let losersRaw = [];
  for (let i = 0; i < sides.length; i += 2) {
    gainersRaw = gainersRaw.concat(sides[i] || []);
    losersRaw = losersRaw.concat(sides[i + 1] || []);
  }

  if (exFilter !== 'ALL') {
    gainersRaw = gainersRaw.filter((x) => x.exchange === exFilter);
    losersRaw = losersRaw.filter((x) => x.exchange === exFilter);
  }

  gainersRaw.sort((a, b) => b.change_pct - a.change_pct);
  losersRaw.sort((a, b) => a.change_pct - b.change_pct);

  const gainers = attachListed(gainersRaw, listed).slice(0, lim);
  const losers = attachListed(losersRaw, listed).slice(0, lim);

  return {
    exchange: exFilter,
    updatedAt: new Date().toISOString(),
    gainers,
    losers,
    source: 'tradingview',
  };
}

module.exports = {
  fetchTvMovers,
  MINING_SECTORS,
  MARKET_SPECS,
};
