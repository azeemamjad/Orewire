const db = require('../../db');
const { PLATFORM } = require('./settings');

async function getAnalytics({ limit = 30 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const [runs, today, week] = await Promise.all([
    db.query(
      `SELECT id, started_at, finished_at, status, trigger, item_count, thread_url, error, dry_run
         FROM social_post_runs
        WHERE platform = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [PLATFORM, lim],
    ),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('success', 'dry_run'))::int AS ok
         FROM social_post_runs
        WHERE platform = $1
          AND started_at > NOW() - INTERVAL '1 day'`,
      [PLATFORM],
    ),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'success')::int AS success,
         COUNT(*) FILTER (WHERE status = 'dry_run')::int AS dry_run,
         COUNT(*) FILTER (WHERE status = 'error')::int AS error
         FROM social_post_runs
        WHERE platform = $1
          AND started_at > NOW() - INTERVAL '7 days'`,
      [PLATFORM],
    ),
  ]);

  const w = week.rows[0] || { total: 0, success: 0, dry_run: 0, error: 0 };
  const liveAttempts = (w.success || 0) + (w.error || 0);
  const successRate7d = liveAttempts > 0 ? Math.round((100 * (w.success || 0)) / liveAttempts) : null;

  return {
    runs: runs.rows,
    counters: {
      runsToday: today.rows[0]?.total || 0,
      okToday: today.rows[0]?.ok || 0,
      success7d: w.success || 0,
      dryRun7d: w.dry_run || 0,
      error7d: w.error || 0,
      total7d: w.total || 0,
      successRate7d,
    },
  };
}

module.exports = { getAnalytics };
