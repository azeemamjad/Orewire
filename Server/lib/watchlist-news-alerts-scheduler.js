const cron = require('node-cron');
const { processPendingWatchlistNewsEmails } = require('./watchlist-news-alerts');

const CRON_EXPR = process.env.WATCHLIST_NEWS_CRON || '*/10 * * * *';

function startWatchlistNewsAlertsScheduler() {
  if (process.env.WATCHLIST_NEWS_CRON_ENABLED === 'false') {
    console.log('[watchlist-news] Scheduler disabled');
    return null;
  }

  const task = cron.schedule(CRON_EXPR, async () => {
    try {
      await processPendingWatchlistNewsEmails();
    } catch (err) {
      console.error('[watchlist-news] Scheduler run failed:', err?.message || err);
    }
  });

  console.log(`[watchlist-news] Scheduled: "${CRON_EXPR}"`);
  return task;
}

module.exports = { startWatchlistNewsAlertsScheduler };
