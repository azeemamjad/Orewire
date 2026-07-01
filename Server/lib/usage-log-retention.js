/**
 * Retention for ai_usage_events and proxy_usage_events (default 3 days).
 */
const db = require('../db');

const DEFAULT_RETENTION_DAYS = 3;

function retentionDays() {
  const n = parseInt(process.env.USAGE_LOG_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

async function pruneUsageLogs() {
  const days = retentionDays();
  const ai = await db.query(
    `DELETE FROM ai_usage_events
     WHERE started_at < NOW() - make_interval(days => $1::int)`,
    [days],
  );
  const proxy = await db.query(
    `DELETE FROM proxy_usage_events
     WHERE started_at < NOW() - make_interval(days => $1::int)`,
    [days],
  );
  const removed = { ai: ai.rowCount || 0, proxy: proxy.rowCount || 0 };
  if (removed.ai > 0 || removed.proxy > 0) {
    console.log(
      `[usage-log] Pruned events older than ${days}d — ai: ${removed.ai}, proxy: ${removed.proxy}`,
    );
  }
  return removed;
}

module.exports = {
  retentionDays,
  pruneUsageLogs,
};
