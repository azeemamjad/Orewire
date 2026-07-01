/**
 * OreWire email templates — public exports.
 * @see ./layout.js shared brand shell
 */
const { escapeHtml, emailConfig, appBaseUrl } = require('./layout');
const { renderMorningBriefSubscribeEmail } = require('./morning-brief-subscribe');
const { renderWelcomeEmail } = require('./welcome');
const { renderOtpEmail } = require('./otp');
const { renderAdminCredentialsEmail } = require('./admin-credentials');
const {
  renderDailyBriefing,
  briefingSubject,
  fmtDateLong,
  COMMODITY_CODES,
  INDEX_CODES,
} = require('./daily-briefing');
const {
  renderWatchlistFilingAlertEmail,
  filingAlertSubject,
  normalizeFilingType,
  slugLabel: filingSlugLabel,
} = require('./watchlist-filing-alert');
const {
  renderWatchlistNewsAlertEmail,
  newsAlertSubject,
  headlineTypeFromTitle,
  slugLabel: newsSlugLabel,
} = require('./watchlist-news-alert');

module.exports = {
  escapeHtml,
  emailConfig,
  appBaseUrl,
  renderMorningBriefSubscribeEmail,
  renderWelcomeEmail,
  renderOtpEmail,
  renderAdminCredentialsEmail,
  renderDailyBriefing,
  briefingSubject,
  fmtDateLong,
  COMMODITY_CODES,
  INDEX_CODES,
  renderWatchlistFilingAlertEmail,
  filingAlertSubject,
  normalizeFilingType,
  slugLabel: filingSlugLabel,
  renderWatchlistNewsAlertEmail,
  newsAlertSubject,
  headlineTypeFromTitle,
  newsSlugLabel,
};
