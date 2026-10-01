const cron = require('node-cron');
const indexnow = require('../seo/indexnow');
const data = require('../seo/data');
const { companyUrl, filingUrl } = require('../seo/util');

/**
 * Daily freshness ping for IndexNow.
 *
 * Resubmitting the whole catalogue every day would be noise. This submits the
 * pages that are always worth re-crawling (the hubs) plus only the company
 * profiles whose row actually changed inside the window, which is what IndexNow
 * is for: telling Bing that something is new, not that everything exists.
 *
 * Disabled unless INDEXNOW_KEY is set, so an unconfigured environment is
 * unaffected. Google does not use IndexNow; the target here is Bing, and
 * therefore Copilot.
 */

const STATIC_PATHS = ['/', '/companies', '/filings', '/news', '/market-news'];

function hubPaths() {
  return [
    ...data.HUB_COMMODITIES.map((c) => `/companies?commodity=${encodeURIComponent(c)}`),
    ...data.HUB_EXCHANGES.map((e) => `/companies?exchange=${encodeURIComponent(e)}`),
  ];
}

/**
 * Build and submit the ping for a lookback window.
 * Exported so it can be run on demand or from a script.
 *
 * "Changed" means new filings and new news in the window, NOT
 * `companies.updated_at`: the quote refresh bumps that every 30 minutes for every
 * company, so a ping built on it submitted the whole catalogue daily.
 */
async function pingRecent(windowHours = 24) {
  if (!indexnow.enabled()) {
    return { ok: false, skipped: 'INDEXNOW_KEY is not set or is malformed' };
  }

  const hours = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const [filings, news] = await Promise.all([
    data.listFilingsCreatedSince(since).catch(() => []),
    data.listNewsCreatedSince(since).catch(() => []),
  ]);

  const paths = [...STATIC_PATHS, ...hubPaths()];

  // Each new filing's own page, plus the company profile it belongs to: a new
  // filing is the main thing that makes a profile worth recrawling.
  for (const filing of filings) {
    paths.push(filingUrl(filing.id));
    if (filing.company_name) paths.push(companyUrl(filing.company_name));
  }

  for (const item of news) {
    paths.push(`/news/${encodeURIComponent(item.link || item.title)}`);
  }

  // The hubs are constant and the rest can repeat, so submit distinct URLs only.
  const unique = [...new Set(paths)];

  const result = await indexnow.submit(unique);
  return {
    ...result,
    windowHours: hours,
    filings: filings.length,
    news: news.length,
    urls: unique.length,
  };
}

function startIndexNowScheduler() {
  if (!indexnow.enabled()) {
    console.log('[seo-indexnow] Off — set INDEXNOW_KEY to enable freshness pings');
    return;
  }

  // Daily at 05:30 server local time, after the overnight scrape and news jobs.
  const schedule = process.env.SEO_INDEXNOW_CRON || '30 5 * * *';
  if (!cron.validate(schedule)) {
    console.warn(`[seo-indexnow] Invalid cron "${schedule}" — scheduler disabled`);
    return;
  }

  const windowHours = Number(process.env.SEO_INDEXNOW_WINDOW_HOURS || 24);

  cron.schedule(schedule, () => {
    pingRecent(windowHours)
      .then((result) => {
        if (result.ok) {
          console.log(
            `[seo-indexnow] Submitted ${result.urls} url(s) (${result.filings} new filing(s), ${result.news} new news item(s) in ${result.windowHours}h), HTTP ${result.status}`
          );
        } else {
          console.warn(
            `[seo-indexnow] Submission skipped or failed: ${result.skipped || result.error || `HTTP ${result.status}`}`
          );
        }
      })
      .catch((err) => {
        console.error('[seo-indexnow] Scheduled ping failed:', err?.message || err);
      });
  });

  console.log(`[seo-indexnow] Scheduler active (${schedule}), ${windowHours}h lookback`);
}

module.exports = { startIndexNowScheduler, pingRecent };
