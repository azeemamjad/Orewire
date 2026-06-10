const { withBrowserSession } = require('../../utils/browser-session');
const { humanDelay } = require('../../utils/human');
const {
  buildContextOptions,
  loadCookies,
  saveCookies,
  STEALTH_INIT,
  scrapeTransferAgentForCompany,
} = require('./transfer-agent');
const { isNetworkError } = require('../../utils/proxy-fallback');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runTransferAgentBatchOnSession(companies, options = {}) {
  const taskSlug = options.taskSlug || 'sedar_transfer_agent';
  // Slower, more variable cadence to look human (the wall scores request rhythm).
  // Tunable via env; defaults are deliberately conservative.
  const delay = parseInt(process.env.TA_DELAY_MS || '6000', 10);
  const jitter = parseInt(process.env.TA_DELAY_JITTER_MS || '5000', 10);
  // Every N companies, take a longer "coffee break" to break the rhythm.
  const breakEvery = parseInt(process.env.TA_BREAK_EVERY || '12', 10);
  const breakMin = parseInt(process.env.TA_BREAK_MIN_MS || '30000', 10);
  const breakMax = parseInt(process.env.TA_BREAK_MAX_MS || '90000', 10);

  return withBrowserSession(taskSlug, options, async ({ page, context, guardCaptcha }) => {
    if (process.env.OREWIRE_RELAY !== 'in-process') {
      await context.addInitScript(STEALTH_INIT);
    }
    await loadCookies(context);

    const out = [];
    let anySuccess = false;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      let row;
      try {
        const ta = await scrapeTransferAgentForCompany(page, c.name, { guardCaptcha });
        anySuccess = true;
        row = {
          id: c.id ?? null,
          name: c.name,
          ticker: c.ticker ?? null,
          transfer_agent: ta || null,
        };
      } catch (err) {
        // An unsolved bot wall blocks every remaining company — abort the batch
        // rather than churn through them all hitting the same wall.
        if (err?.name === 'CaptchaRequiredError') throw err;
        // A sustained HTTP block (rate-limit / bot-wall) on the navigation will
        // hit every remaining company the same way — abort instead of churning.
        if (err?.name === 'NavigationBlockedError' && !anySuccess) throw err;
        if (isNetworkError(err) && !anySuccess) throw err;
        row = {
          id: c.id ?? null,
          name: c.name,
          ticker: c.ticker ?? null,
          transfer_agent: null,
          error: err.message,
        };
      }
      out.push(row);
      // Hand the result back immediately so the caller can log + persist as we
      // go — otherwise nothing is saved until the whole (multi-hour) batch ends,
      // and stopping mid-run would lose everything scraped so far.
      if (options.onResult) {
        try { await options.onResult(row, i, companies.length); } catch { /* non-fatal */ }
      }
      await saveCookies(context);
      if (i < companies.length - 1) {
        // Occasional long break, otherwise a wide-jittered gap between lookups.
        if (breakEvery > 0 && (i + 1) % breakEvery === 0) {
          await humanDelay(breakMin, breakMax);
        } else {
          await humanDelay(delay, delay + jitter);
        }
      }
    }
    return out;
  });
}

module.exports = { runTransferAgentBatchOnSession };
