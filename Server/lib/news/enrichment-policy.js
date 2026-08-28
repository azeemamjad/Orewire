/**
 * News AI enrichment gates — limits spend on stale or low-value headlines.
 *
 * Env (all optional):
 *   NEWS_ENRICH_ENABLED=true
 *   NEWS_ENRICH_MAX_AGE_HOURS=48        — skip items older than this
 *   NEWS_ENRICH_DAILY_MAX_CALLS=30      — max LLM calls / day (feature=news_enrichment)
 *   NEWS_ENRICH_BATCH_SIZE=5            — headlines per LLM call
 *   NEWS_ENRICH_REQUIRE_COMPANY=true    — only enrich rows linked to a company
 *   NEWS_ENRICH_MAX_DRAIN_BATCHES=2     — max batches per drainUnprocessedNews() call
 */
const db = require('../../db');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function getPolicy() {
  return {
    enabled: envBool('NEWS_ENRICH_ENABLED', true),
    maxAgeHours: envInt('NEWS_ENRICH_MAX_AGE_HOURS', 48),
    dailyMaxCalls: envInt('NEWS_ENRICH_DAILY_MAX_CALLS', 30),
    batchSize: Math.max(1, envInt('NEWS_ENRICH_BATCH_SIZE', 5)),
    requireCompany: envBool('NEWS_ENRICH_REQUIRE_COMPANY', true),
    maxDrainBatches: Math.max(1, envInt('NEWS_ENRICH_MAX_DRAIN_BATCHES', 2)),
  };
}

function maxAgeCutoff(maxAgeHours = getPolicy().maxAgeHours) {
  return new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
}

function isWithinEnrichmentWindow(pubDate, maxAgeHours = getPolicy().maxAgeHours) {
  if (!pubDate) return false;
  const d = pubDate instanceof Date ? pubDate : new Date(pubDate);
  if (Number.isNaN(d.getTime())) return false;
  return d >= maxAgeCutoff(maxAgeHours);
}

let _todayCallsCache = { count: null, loadedAt: 0 };
const CALL_COUNT_TTL_MS = 30 * 1000;

async function getTodayEnrichmentCallCount() {
  const now = Date.now();
  if (_todayCallsCache.count != null && now - _todayCallsCache.loadedAt < CALL_COUNT_TTL_MS) {
    return _todayCallsCache.count;
  }
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM ai_usage_events
       WHERE feature = 'news_enrichment'
         AND started_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    );
    const count = r.rows[0]?.n ?? 0;
    _todayCallsCache = { count, loadedAt: now };
    return count;
  } catch {
    return _todayCallsCache.count ?? 0;
  }
}

function invalidateEnrichmentBudgetCache() {
  _todayCallsCache.loadedAt = 0;
}

async function canEnrichMore({ callsNeeded = 1 } = {}) {
  const policy = getPolicy();
  if (!policy.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  const used = await getTodayEnrichmentCallCount();
  if (used + callsNeeded > policy.dailyMaxCalls) {
    return { ok: false, reason: 'daily_budget', used, limit: policy.dailyMaxCalls };
  }
  return { ok: true, used, limit: policy.dailyMaxCalls };
}

function filterRowsForEnrichment(rows, options = {}) {
  const policy = getPolicy();
  const requireCompany = options.requireCompany ?? policy.requireCompany;
  const maxAgeHours = options.maxAgeHours ?? policy.maxAgeHours;

  return rows.filter((row) => {
    if (requireCompany && !row.company_id) return false;
    return isWithinEnrichmentWindow(row.pub_date, maxAgeHours);
  });
}

let _lastBudgetLogAt = 0;

function logBudgetSkip(reason, detail = '') {
  const now = Date.now();
  if (now - _lastBudgetLogAt < 60 * 1000) return;
  _lastBudgetLogAt = now;
  const suffix = detail ? ` (${detail})` : '';
  console.warn(`[News] AI enrichment skipped: ${reason}${suffix}`);
}

module.exports = {
  getPolicy,
  maxAgeCutoff,
  isWithinEnrichmentWindow,
  getTodayEnrichmentCallCount,
  invalidateEnrichmentBudgetCache,
  canEnrichMore,
  filterRowsForEnrichment,
  logBudgetSkip,
};
