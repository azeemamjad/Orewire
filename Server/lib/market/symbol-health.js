const db = require('../../db');
const { fetchTvQuote } = require('./tv-quote');
const { fetchYahooByExchange } = require('./yahoo-quote');
const { getDefaultTvSymbolForCompany } = require('./instrument-symbols-store');

// A symbol is only flagged after this many CONSECUTIVE daily checks come back
// "missing" (a provider responded but had no price — i.e. a wrong/dead symbol).
// The daily batch runs once/day, so the default ≈ 3 days of confirmed absence.
const FAIL_THRESHOLD = Math.max(1, parseInt(process.env.SYMBOL_FLAG_THRESHOLD || '3', 10) || 3);

// Provider-outage guard: if the first N batch checks are ALL unreachable
// (both TradingView and Yahoo threw), assume an outage and abort the run rather
// than churn through the whole book. ("unknown" never flags anyway.)
const PROVIDER_DOWN_SAMPLE = 25;

// Cache the tri-state classification per tv symbol so page-visit checks don't
// hammer the providers. The daily batch bypasses this cache (force: true).
const healthCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(symbol) {
  const e = healthCache.get(symbol);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    healthCache.delete(symbol);
    return undefined;
  }
  return e.value;
}

function cacheSet(symbol, value) {
  healthCache.set(symbol, { ts: Date.now(), value });
}

/**
 * Backwards-compatible TV-only price check (used by the admin instrument-symbols
 * routes to confirm a freshly-entered symbol resolves). Returns a boolean.
 */
async function isTvSymbolHealthy(tvSymbol) {
  if (!tvSymbol) return false;
  try {
    const data = await fetchTvQuote(tvSymbol);
    return !!(data && data.close != null);
  } catch {
    return false;
  }
}

/**
 * Classify a company's symbol by cross-checking BOTH TradingView and Yahoo.
 *
 * - healthy : at least one provider returned a price.
 * - missing : at least one provider RESPONDED (no throw) but had no price, and
 *             none had a price. TradingView uses no_404=true, so a wrong symbol
 *             answers HTTP 200 with close:null; Yahoo 404s (throws) on a bad
 *             symbol. So a genuinely dead symbol = TV responded-no-price.
 * - unknown : every attempted provider threw (network / 429 / 5xx / timeout).
 *             Transient — must NEVER flag.
 *
 * @returns {{ status: 'healthy'|'missing'|'unknown', detail: string|null }}
 */
async function classifyCompanySymbol(company, tvSymbol) {
  let tvPriced = false;
  let tvResponded = false;
  if (tvSymbol) {
    try {
      const tv = await fetchTvQuote(tvSymbol);
      tvResponded = true;
      if (tv && tv.close != null) tvPriced = true;
    } catch { /* transient / bad — leave tvResponded false */ }
  }

  let yaPriced = false;
  let yaResponded = false;
  if (company.exchange && company.ticker) {
    try {
      const ya = await fetchYahooByExchange(company.exchange, company.ticker);
      yaResponded = true;
      if (ya && ya.close != null) yaPriced = true;
    } catch { /* transient / bad symbol on Yahoo */ }
  }

  if (tvPriced || yaPriced) return { status: 'healthy', detail: null };

  if (tvResponded || yaResponded) {
    const src = [tvResponded ? 'TradingView' : null, yaResponded ? 'Yahoo' : null]
      .filter(Boolean)
      .join(' or ');
    return { status: 'missing', detail: `No price on ${src} for ${tvSymbol}` };
  }

  return { status: 'unknown', detail: 'All quote providers were unreachable' };
}

async function flagCompanySymbolIssue(companyId, tvSymbol, reason, failCount) {
  await db.query(
    `UPDATE companies SET
       symbol_fail_count = $4,
       symbol_flagged_at = COALESCE(symbol_flagged_at, NOW()),
       symbol_flagged_reason = $2,
       symbol_flagged_tv_symbol = $3,
       symbol_last_checked_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [companyId, reason || `No price for ${tvSymbol}`, tvSymbol, failCount],
  );
}

async function clearCompanySymbolFlag(companyId) {
  await db.query(
    `UPDATE companies SET
       symbol_flagged_at = NULL,
       symbol_flagged_reason = NULL,
       symbol_flagged_tv_symbol = NULL,
       symbol_fail_count = 0,
       symbol_last_checked_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [companyId],
  );
}

/**
 * @param {object} company                 company row (id, exchange, ticker, symbol_flagged_at, symbol_fail_count)
 * @param {object} [opts]
 * @param {boolean} [opts.force]            bypass the classification cache (daily batch)
 * @param {boolean} [opts.flagOnMissing]    increment the counter / raise a flag on "missing" (batch only; page visits pass false)
 */
async function checkCompanySymbolHealth(company, { force = false, flagOnMissing = true } = {}) {
  if (!company?.id) return { status: 'unknown', healthy: false, tvSymbol: null };
  const tvSymbol = await getDefaultTvSymbolForCompany(company);
  if (!tvSymbol) return { status: 'unknown', healthy: false, tvSymbol: null };

  let status;
  let detail = null;
  let fresh = false;

  if (!force) {
    const cached = cacheGet(tvSymbol);
    if (cached) { status = cached.status; detail = cached.detail; }
  }
  if (!status) {
    const c = await classifyCompanySymbol(company, tvSymbol);
    status = c.status;
    detail = c.detail;
    cacheSet(tvSymbol, { status, detail });
    fresh = true;
  }

  // Cache hits are pure reads — no DB writes, no counter changes.
  if (!fresh && !force) {
    return { status, healthy: status === 'healthy', tvSymbol };
  }

  if (status === 'healthy') {
    if (company.symbol_flagged_at || Number(company.symbol_fail_count) > 0) {
      await clearCompanySymbolFlag(company.id);
    } else {
      await db.query(
        `UPDATE companies SET symbol_last_checked_at = NOW() WHERE id = $1`,
        [company.id],
      );
    }
    return { status, healthy: true, tvSymbol };
  }

  if (status === 'unknown') {
    // Transient provider failure — never flag, never increment the counter.
    await db.query(
      `UPDATE companies SET symbol_last_checked_at = NOW() WHERE id = $1`,
      [company.id],
    );
    return { status, healthy: false, tvSymbol };
  }

  // status === 'missing'
  if (!flagOnMissing) {
    // Page-visit path: observe only, never raise a flag.
    return { status, healthy: false, tvSymbol };
  }

  const nextCount = (Number(company.symbol_fail_count) || 0) + 1;
  const reason = `${detail || `No price for ${tvSymbol}`} (${nextCount} consecutive daily check${nextCount === 1 ? '' : 's'})`;

  if (nextCount >= FAIL_THRESHOLD) {
    await flagCompanySymbolIssue(company.id, tvSymbol, reason, nextCount);
  } else {
    await db.query(
      `UPDATE companies SET symbol_fail_count = $2, symbol_last_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [company.id, nextCount],
    );
  }
  return { status, healthy: false, tvSymbol, failCount: nextCount, flagged: nextCount >= FAIL_THRESHOLD };
}

async function runSymbolHealthBatch() {
  const r = await db.query(
    `SELECT id, exchange, ticker, name, symbol_flagged_at, symbol_fail_count
       FROM companies
      WHERE ticker IS NOT NULL AND ticker <> ''`,
  );

  let checked = 0;
  let flagged = 0;
  let cleared = 0;
  let missing = 0;
  let unknown = 0;

  for (const row of r.rows) {
    const before = !!row.symbol_flagged_at;
    const res = await checkCompanySymbolHealth(row, { force: true });
    checked += 1;
    if (res.status === 'unknown') unknown += 1;
    if (res.status === 'missing') missing += 1;
    if (res.flagged && !before) flagged += 1;
    if (res.status === 'healthy' && before) cleared += 1;

    // Provider-outage guard: if the opening sample is entirely unreachable,
    // both providers are almost certainly down — abort instead of churning.
    if (checked === PROVIDER_DOWN_SAMPLE && unknown === PROVIDER_DOWN_SAMPLE) {
      console.warn(
        `[symbol-health] First ${PROVIDER_DOWN_SAMPLE} checks all unreachable — aborting batch (provider outage suspected).`,
      );
      return { checked, flagged, cleared, missing, unknown, aborted: true };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { checked, flagged, cleared, missing, unknown };
}

module.exports = {
  isTvSymbolHealthy,
  classifyCompanySymbol,
  flagCompanySymbolIssue,
  clearCompanySymbolFlag,
  checkCompanySymbolHealth,
  runSymbolHealthBatch,
  FAIL_THRESHOLD,
};
