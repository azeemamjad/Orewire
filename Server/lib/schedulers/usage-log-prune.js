const cron = require('node-cron');
const { pruneUsageLogs } = require('../usage-log-retention');

function startUsageLogPruneScheduler() {
  if (process.env.USAGE_LOG_PRUNE_ENABLED === 'false') return;

  // Daily at 04:15 server local time
  const schedule = process.env.USAGE_LOG_PRUNE_CRON || '15 4 * * *';
  if (!cron.validate(schedule)) {
    console.warn(`[usage-log] Invalid prune cron "${schedule}" — scheduler disabled`);
    return;
  }

  cron.schedule(schedule, () => {
    pruneUsageLogs().catch((err) => {
      console.error('[usage-log] Scheduled prune failed:', err?.message || err);
    });
  });

  console.log(`[usage-log] Prune scheduler active (${schedule})`);
}

module.exports = { startUsageLogPruneScheduler };
