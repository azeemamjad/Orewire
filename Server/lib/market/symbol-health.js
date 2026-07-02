const db = require('../../db');
const { fetchTvQuote } = require('./tv-quote');
const { getDefaultTvSymbolForCompany } = require('./instrument-symbols-store');
const { upsertAutoTask, resolveAutoTask } = require('../infra/va-tasks-sync');

const healthCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(symbol) {
  const e = healthCache.get(symbol);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    healthCache.delete(symbol);
    return undefined;
  }
  return e.healthy;
}

function cacheSet(symbol, healthy) {
  healthCache.set(symbol, { ts: Date.now(), healthy });
}

async function isTvSymbolHealthy(tvSymbol) {
  if (!tvSymbol) return false;
  const cached = cacheGet(tvSymbol);
  if (cached !== undefined) return cached;

  try {
    const data = await fetchTvQuote(tvSymbol);
    const healthy = data != null && data.close != null;
    cacheSet(tvSymbol, healthy);
    return healthy;
  } catch {
    cacheSet(tvSymbol, false);
    return false;
  }
}

function vaTaskForCompany(company, tvSymbol, reason) {
  const ex = company.exchange || '';
  const tk = company.ticker || '';
  return {
    sourceKey: `companies|symbol_invalid|${company.id}`,
    module: 'companies',
    errorType: 'symbol_invalid',
    title: `Fix ticker: ${company.name} (${ex}:${tk})`,
    description: reason || `TradingView symbol ${tvSymbol} returned no price. Add correct listings and set default.`,
    actionUrl: `/admin/companies.html?edit=${company.id}&tab=symbols`,
    severity: 'medium',
    occurrenceCount: 1,
    sampleDetail: tvSymbol,
  };
}

async function flagCompanySymbolIssue(companyId, tvSymbol, reason) {
  const c = await db.query(
    `SELECT id, name, exchange, ticker, symbol_flagged_at FROM companies WHERE id = $1`,
    [companyId],
  );
  const company = c.rows[0];
  if (!company) return;

  const msg = reason || `TV scanner: no price for ${tvSymbol}`;
  await db.query(
    `UPDATE companies SET
       symbol_flagged_at = COALESCE(symbol_flagged_at, NOW()),
       symbol_flagged_reason = $2,
       symbol_flagged_tv_symbol = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [companyId, msg, tvSymbol],
  );
  await upsertAutoTask(vaTaskForCompany(company, tvSymbol, msg));
}

async function clearCompanySymbolFlag(companyId) {
  await db.query(
    `UPDATE companies SET
       symbol_flagged_at = NULL,
       symbol_flagged_reason = NULL,
       symbol_flagged_tv_symbol = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [companyId],
  );
  await resolveAutoTask(`companies|symbol_invalid|${companyId}`);
}

async function checkCompanySymbolHealth(company, { force = false } = {}) {
  if (!company?.id) return { healthy: false, tvSymbol: null };
  const tvSymbol = await getDefaultTvSymbolForCompany(company);
  if (!tvSymbol) return { healthy: false, tvSymbol: null };

  if (!force) {
    const cached = cacheGet(tvSymbol);
    if (cached !== undefined) {
      if (cached) {
        if (company.symbol_flagged_at) await clearCompanySymbolFlag(company.id);
      } else if (!company.symbol_flagged_at) {
        await flagCompanySymbolIssue(company.id, tvSymbol, `TV scanner: no price for ${tvSymbol}`);
      }
      return { healthy: cached, tvSymbol };
    }
  }

  const healthy = await isTvSymbolHealthy(tvSymbol);
  if (healthy) {
    if (company.symbol_flagged_at) await clearCompanySymbolFlag(company.id);
  } else {
    await flagCompanySymbolIssue(
      company.id,
      tvSymbol,
      `TV scanner: no price for ${tvSymbol}`,
    );
  }
  return { healthy, tvSymbol };
}

async function runSymbolHealthBatch() {
  const r = await db.query(
    `SELECT id, exchange, ticker, name, symbol_flagged_at
       FROM companies
      WHERE ticker IS NOT NULL AND ticker <> ''`,
  );
  let flagged = 0;
  let cleared = 0;
  for (const row of r.rows) {
    const before = !!row.symbol_flagged_at;
    const { healthy } = await checkCompanySymbolHealth(row, { force: true });
    if (!healthy && !before) flagged += 1;
    if (healthy && before) cleared += 1;
    await new Promise((res) => setTimeout(res, 200));
  }
  return { checked: r.rows.length, flagged, cleared };
}

module.exports = {
  isTvSymbolHealthy,
  flagCompanySymbolIssue,
  clearCompanySymbolFlag,
  checkCompanySymbolHealth,
  runSymbolHealthBatch,
};
