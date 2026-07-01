const { initPipelineConfig } = require('../../pipeline/config');
const { bootstrapSchedulers } = require('./pipeline');
const { startDailyBriefingScheduler } = require('../briefing/scheduler');
const { startWatchlistNewsAlertsScheduler } = require('../watchlist/news-alerts-scheduler');
const { startWatchlistFilingAlertsScheduler } = require('../watchlist/filing-alerts-scheduler');
const { startCompanyQuoteScheduler } = require('../market/company-quote-scheduler');
const { maybeKickInitialRefresh } = require('../market/company-quote-refresh');
const { startNewsRssScheduler } = require('./news-rss');
const { startVaTasksScheduler } = require('./va-tasks');
const { startUsageLogPruneScheduler } = require('./usage-log-prune');

async function startPipelineSchedulers() {
  const cfg = await initPipelineConfig();
  bootstrapSchedulers(cfg);
  return cfg;
}

function startBackgroundSchedulers({ server, app } = {}) {
  try {
    startDailyBriefingScheduler();
  } catch (err) {
    console.error('[briefing] Scheduler failed to start:', err?.message || err);
  }

  try {
    startWatchlistNewsAlertsScheduler();
  } catch (err) {
    console.error('[watchlist-news] Scheduler failed to start:', err?.message || err);
  }

  try {
    startWatchlistFilingAlertsScheduler();
  } catch (err) {
    console.error('[watchlist-filing] Scheduler failed to start:', err?.message || err);
  }

  try {
    startCompanyQuoteScheduler();
    maybeKickInitialRefresh().catch((err) => {
      console.error('[quotes] Boot refresh check failed:', err?.message || err);
    });
  } catch (err) {
    console.error('[quotes] Scheduler failed to start:', err?.message || err);
  }

  try {
    startNewsRssScheduler();
  } catch (err) {
    console.error('[news-rss] Scheduler failed to start:', err?.message || err);
  }

  try {
    startVaTasksScheduler();
  } catch (err) {
    console.error('[VA tasks] Scheduler failed to start:', err?.message || err);
  }

  try {
    startUsageLogPruneScheduler();
  } catch (err) {
    console.error('[usage-log] Scheduler failed to start:', err?.message || err);
  }

  if (process.env.RELAY_ENABLED === 'true' && server && app) {
    const { initRelay } = require('../../relay');
    initRelay(app, server).catch((err) => {
      console.error('[Relay] Failed to start:', err?.message || err);
    });
  }
}

async function startAll({ server, app } = {}) {
  try {
    await startPipelineSchedulers();
  } catch (err) {
    console.error('[pipeline] Config/schedulers failed to start:', err?.message || err);
  }

  startBackgroundSchedulers({ server, app });
}

module.exports = {
  startAll,
  startPipelineSchedulers,
  startBackgroundSchedulers,
};
