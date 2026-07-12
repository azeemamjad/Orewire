const cron = require('node-cron');
const { runTickerRecheck } = require('../../jobs/ticker-recheck');

// Runs after the symbol-health batch (default 07:00) so it works off fresh flags.
const CRON_EXPR = process.env.TICKER_RECHECK_CRON || '0 9 * * *';
const TZ = process.env.TICKER_RECHECK_TIMEZONE || 'America/Toronto';

function startTickerRecheckScheduler() {
  if (process.env.TICKER_RECHECK_CRON_ENABLED === 'false') {
    console.log('[ticker-recheck] Scheduler disabled (TICKER_RECHECK_CRON_ENABLED=false)');
    return null;
  }
  if (!cron.validate(CRON_EXPR)) {
    console.error(`[ticker-recheck] Invalid cron expression: "${CRON_EXPR}"`);
    return null;
  }

  const task = cron.schedule(
    CRON_EXPR,
    async () => {
      try {
        await runTickerRecheck({});
      } catch (err) {
        if (err?.code === 'ALREADY_RUNNING') return;
        console.error('[ticker-recheck] Batch failed:', err?.message || err);
      }
    },
    { timezone: TZ },
  );

  console.log(`[ticker-recheck] Scheduled daily: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startTickerRecheckScheduler };
