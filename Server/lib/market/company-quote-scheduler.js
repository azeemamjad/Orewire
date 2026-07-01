const cron = require('node-cron');
const { refreshCompanyQuotes, isRunning } = require('./company-quote-refresh');

const CRON_EXPR = process.env.COMPANY_QUOTE_CRON || '*/30 * * * *';
const TZ = process.env.COMPANY_QUOTE_TIMEZONE || 'America/Toronto';

function startCompanyQuoteScheduler() {
  if (process.env.COMPANY_QUOTE_CRON_ENABLED === 'false') {
    console.log('[quotes] Scheduler disabled (COMPANY_QUOTE_CRON_ENABLED=false)');
    return null;
  }

  if (!cron.validate(CRON_EXPR)) {
    console.error(`[quotes] Invalid cron expression: "${CRON_EXPR}"`);
    return null;
  }

  const task = cron.schedule(
    CRON_EXPR,
    async () => {
      if (isRunning()) {
        console.warn('[quotes] Previous refresh still in progress — skipping');
        return;
      }
      try {
        await refreshCompanyQuotes({ reason: 'cron' });
      } catch (err) {
        if (err.code !== 'ALREADY_RUNNING') {
          console.error('[quotes] Scheduled refresh failed:', err?.message || err);
        }
      }
    },
    { timezone: TZ },
  );

  console.log(`[quotes] Scheduled company quote refresh: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startCompanyQuoteScheduler };
