const cron = require('node-cron');
const { refreshMoversSnapshot } = require('./movers-refresh');

// Default: every minute. Free TV scanner can handle ~4 POSTs/min easily.
const CRON_EXPR = process.env.MOVERS_CRON || '* * * * *';
const TZ = process.env.MOVERS_TIMEZONE || process.env.COMPANY_QUOTE_TIMEZONE || 'America/Toronto';

function startMoversScheduler() {
  if (process.env.MOVERS_CRON_ENABLED === 'false') {
    console.log('[movers] Scheduler disabled (MOVERS_CRON_ENABLED=false)');
    return null;
  }

  if (!cron.validate(CRON_EXPR)) {
    console.error(`[movers] Invalid cron expression: "${CRON_EXPR}"`);
    return null;
  }

  // Kick once on boot so the first page load is warm.
  refreshMoversSnapshot({ reason: 'boot' }).catch(() => {});

  const task = cron.schedule(
    CRON_EXPR,
    () => {
      refreshMoversSnapshot({ reason: 'cron' }).catch(() => {});
    },
    { timezone: TZ },
  );

  console.log(`[movers] Scheduled TV scanner refresh: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startMoversScheduler };
