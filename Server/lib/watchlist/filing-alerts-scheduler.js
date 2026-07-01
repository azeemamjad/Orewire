const cron = require('node-cron');
const { sendMorningWatchlistFilingAlerts } = require('./filing-alerts');

const CRON_EXPR = process.env.WATCHLIST_FILING_CRON || '35 7 * * *';
const TZ = process.env.BRIEFING_TIMEZONE || 'America/Toronto';

let running = false;

function startWatchlistFilingAlertsScheduler() {
  if (process.env.WATCHLIST_FILING_CRON_ENABLED === 'false') {
    console.log('[watchlist-filing] Scheduler disabled');
    return null;
  }

  const task = cron.schedule(
    CRON_EXPR,
    async () => {
      if (running) {
        console.warn('[watchlist-filing] Previous run still in progress — skipping');
        return;
      }
      running = true;
      try {
        await sendMorningWatchlistFilingAlerts();
      } finally {
        running = false;
      }
    },
    { timezone: TZ },
  );

  console.log(`[watchlist-filing] Scheduled morning send: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startWatchlistFilingAlertsScheduler };
