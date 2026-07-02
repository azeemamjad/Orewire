/**
 * Background refresh of live quotes for all listed companies.
 * Snapshots are stored on the companies row and power Top Gainers / Losers.
 */
const db = require('../../db');
const { fetchCompanyQuote } = require('./market-quote');
const { addLog } = require('../../pipeline/state');
const {
  isJobRunning, syncJob, startJob, endJob,
} = require('../infra/job-tracker');

const JOB_ID = 'company-quotes';
const SUPPORTED_EXCHANGES = ['TSXV', 'TSX', 'CSE', 'ASX'];

const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.COMPANY_QUOTE_CONCURRENCY || '3', 10));
const DEFAULT_DELAY_MS = Math.max(0, parseInt(process.env.COMPANY_QUOTE_DELAY_MS || '300', 10));
const STALE_MINUTES = Math.max(5, parseInt(process.env.COMPANY_QUOTE_STALE_MINUTES || '35', 10));

let _running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRunning() {
  syncJob(JOB_ID);
  return _running || isJobRunning(JOB_ID);
}

function computedMcap(price, sharesOut, fallbackMcap) {
  const shares = Number(sharesOut);
  if (price != null && Number.isFinite(shares) && shares > 0) {
    return price * shares;
  }
  return fallbackMcap ?? null;
}

function normalizeQuoteRow(c) {
  const price = c.quote_price;
  const changePct = c.quote_change_pct;
  if (price == null || changePct == null) return null;
  return {
    ticker: c.ticker,
    name: c.name,
    exchange: c.exchange,
    price,
    change_pct: changePct,
    market_cap: computedMcap(price, c.shares_outstanding, c.market_cap),
    volume: c.quote_volume ?? null,
    perf_ytd: null,
  };
}

async function fetchCompaniesForRefresh({ limit, exchange, ticker } = {}) {
  if (ticker) {
    const r = await db.query(
      `SELECT id, exchange, ticker, name
         FROM companies
        WHERE UPPER(ticker) = UPPER($1)
          AND exchange = ANY($2::text[])
        ORDER BY exchange, id`,
      [ticker, SUPPORTED_EXCHANGES],
    );
    return r.rows;
  }

  const conditions = [
    "ticker IS NOT NULL AND ticker <> ''",
    `exchange = ANY($1::text[])`,
  ];
  const params = [SUPPORTED_EXCHANGES];

  if (exchange && exchange !== 'ALL') {
    params.push(exchange.toUpperCase());
    conditions.push(`exchange = $${params.length}`);
  }

  const sql = `
    SELECT id, exchange, ticker, name
      FROM companies
     WHERE ${conditions.join(' AND ')}
     ORDER BY market_cap DESC NULLS LAST, id ASC
     ${limit ? `LIMIT ${Number(limit)}` : ''}
  `;
  const r = await db.query(sql, params);
  return r.rows;
}

async function saveQuote(companyId, norm) {
  await db.query(
    `UPDATE companies SET
       quote_price       = $2,
       quote_change_pct  = $3,
       quote_change_abs  = $4,
       quote_volume      = $5,
       quote_updated_at  = NOW(),
       updated_at        = NOW()
     WHERE id = $1`,
    [
      companyId,
      norm.price,
      norm.change_pct,
      norm.change_abs,
      norm.volume,
    ],
  );
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  async function runWorker() {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
}

/**
 * Refresh stored quotes for all (or filtered) companies.
 */
async function refreshCompanyQuotes(opts = {}) {
  syncJob(JOB_ID);
  if (isRunning()) {
    const err = new Error('Company quote refresh already running');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }

  _running = true;
  const concurrency = opts.concurrency != null
    ? Math.max(1, Number(opts.concurrency))
    : DEFAULT_CONCURRENCY;
  const delayMs = opts.delayMs != null
    ? Math.max(0, Number(opts.delayMs))
    : DEFAULT_DELAY_MS;
  const args = {
    limit: opts.limit != null ? Number(opts.limit) : null,
    exchange: opts.exchange || null,
    ticker: opts.ticker || null,
    concurrency,
    delayMs,
    reason: opts.reason || 'manual',
  };

  addLog('out', `[Quotes] Starting company quote refresh: ${JSON.stringify(args)}`);
  startJob(JOB_ID, {
    label: 'Company quote refresh',
    pid: process.pid,
    type: 'in-process',
    meta: args,
  });

  let ok = 0;
  let miss = 0;
  let fail = 0;

  try {
    const companies = await fetchCompaniesForRefresh(args);
    addLog('out', `[Quotes] ${companies.length} companies queued (concurrency=${concurrency})`);

    await runPool(companies, concurrency, async (c, i) => {
      const tag = `[${i + 1}/${companies.length}] ${c.exchange}:${c.ticker}`;
      try {
        const data = await fetchCompanyQuote(c.exchange, c.ticker);
        const price = data.close ?? null;
        const changePct = data.change ?? null;
        if (price == null || changePct == null) {
          addLog('warn', `[Quotes] ${tag} — no price/change`);
          miss++;
          return;
        }
        await saveQuote(c.id, {
          price,
          change_pct: changePct,
          change_abs: data.change_abs ?? null,
          volume: data.volume ?? null,
        });
        ok++;
        if ((i + 1) % 50 === 0) {
          addLog('out', `[Quotes] progress ${i + 1}/${companies.length} (ok=${ok} miss=${miss} fail=${fail})`);
        }
      } catch (err) {
        addLog('warn', `[Quotes] ${tag} — ${err.message}`);
        fail++;
      } finally {
        if (delayMs > 0) await sleep(delayMs);
      }
    });

    const summary = { total: companies.length, ok, miss, fail };
    addLog('out', `[Quotes] Done. ok=${ok} miss=${miss} fail=${fail}`);
    try {
      const { clearMoversCache } = require('./movers-cache');
      clearMoversCache();
    } catch { /* ignore */ }
    endJob(JOB_ID, 'completed');
    return summary;
  } catch (err) {
    endJob(JOB_ID, 'failed');
    throw err;
  } finally {
    _running = false;
  }
}

/**
 * Build gainers/losers from stored quote snapshots (all companies with data).
 */
async function buildMoversPayload(exchange = 'ALL', limit = 10) {
  const ex = String(exchange || 'ALL').toUpperCase();
  const lim = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 50);

  const params = [SUPPORTED_EXCHANGES];
  let exchangeClause = '';
  if (ex !== 'ALL') {
    params.push(ex);
    exchangeClause = `AND exchange = $${params.length}`;
  }

  const r = await db.query(
    `SELECT ticker, name, exchange, market_cap, shares_outstanding,
            quote_price, quote_change_pct, quote_volume, quote_updated_at
       FROM companies
      WHERE ticker IS NOT NULL AND ticker <> ''
        AND exchange = ANY($1::text[])
        AND quote_price IS NOT NULL
        AND quote_change_pct IS NOT NULL
        ${exchangeClause}`,
    params,
  );

  const gainers = [];
  const losers = [];
  const seen = new Set();
  let latestTs = 0;

  for (const row of r.rows) {
    const dedupeKey = `${row.exchange}:${String(row.ticker).toUpperCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const item = normalizeQuoteRow(row);
    if (!item) continue;
    const ts = row.quote_updated_at ? new Date(row.quote_updated_at).getTime() : 0;
    if (ts > latestTs) latestTs = ts;
    if (item.change_pct > 0) gainers.push(item);
    else if (item.change_pct < 0) losers.push(item);
  }

  gainers.sort((a, b) => b.change_pct - a.change_pct);
  losers.sort((a, b) => a.change_pct - b.change_pct);

  return {
    exchange: ex,
    updatedAt: latestTs ? new Date(latestTs).toISOString() : new Date().toISOString(),
    gainers: gainers.slice(0, lim),
    losers: losers.slice(0, lim),
    quotedCount: r.rows.length,
  };
}

async function getQuotedCompanyCount() {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM companies
      WHERE quote_updated_at IS NOT NULL
        AND exchange = ANY($1::text[])`,
    [SUPPORTED_EXCHANGES],
  );
  return r.rows[0]?.n || 0;
}

async function getLatestQuoteUpdatedAt() {
  const r = await db.query(
    `SELECT MAX(quote_updated_at) AS latest
       FROM companies
      WHERE exchange = ANY($1::text[])`,
    [SUPPORTED_EXCHANGES],
  );
  return r.rows[0]?.latest || null;
}

function isQuoteDataStale(latest) {
  if (!latest) return true;
  const ageMs = Date.now() - new Date(latest).getTime();
  return ageMs > STALE_MINUTES * 60 * 1000;
}

/**
 * Kick off a refresh when the server boots if we have no data or it is stale.
 * Non-blocking — errors are logged only.
 */
async function maybeKickInitialRefresh() {
  if (process.env.COMPANY_QUOTE_BOOT_REFRESH === 'false') return;
  try {
    const [count, latest] = await Promise.all([
      getQuotedCompanyCount(),
      getLatestQuoteUpdatedAt(),
    ]);
    if (count > 0 && !isQuoteDataStale(latest)) return;
    const reason = count === 0 ? 'bootstrap' : 'stale';
    addLog('out', `[Quotes] Scheduling ${reason} refresh (${count} companies quoted)`);
    refreshCompanyQuotes({ reason }).catch((err) => {
      if (err.code !== 'ALREADY_RUNNING') {
        console.error('[Quotes] Initial refresh failed:', err?.message || err);
      }
    });
  } catch (err) {
    console.error('[Quotes] Initial refresh check failed:', err?.message || err);
  }
}

module.exports = {
  refreshCompanyQuotes,
  buildMoversPayload,
  maybeKickInitialRefresh,
  isRunning,
  SUPPORTED_EXCHANGES,
  STALE_MINUTES,
};
