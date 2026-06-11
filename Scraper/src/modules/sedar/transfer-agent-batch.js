const path = require('path');
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

/** Yield the Relay queue during idle gaps so Relay View can interact. */
async function relayIdleGap(workerId, min, max, shouldStop) {
  if (process.env.OREWIRE_RELAY !== 'in-process' || !workerId) {
    await humanDelay(min, max);
    return;
  }
  try {
    const serverRoot =
      process.env.OREWIRE_SERVER_PATH || path.resolve(__dirname, '../../../../Server');
    const { yieldQueue, waitForQueueIdle } = require(path.join(serverRoot, 'relay/worker-queue'));
    const { TaskStoppedError } = require(path.join(serverRoot, 'relay/task-cancel'));
    yieldQueue(workerId);
    await humanDelay(min, max);
    if (shouldStop?.()) throw new TaskStoppedError();
    await waitForQueueIdle(workerId, 15000).catch(() => {});
  } catch (err) {
    if (err?.name === 'TaskStoppedError') throw err;
    await humanDelay(min, max);
  }
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

  return withBrowserSession(taskSlug, options, async ({ page, context, guardCaptcha, shouldStop, workerId }) => {
    if (process.env.OREWIRE_RELAY !== 'in-process') {
      await context.addInitScript(STEALTH_INIT);
    }
    await loadCookies(context);

    const out = [];
    let anySuccess = false;

    for (let i = 0; i < companies.length; i++) {
      if (shouldStop?.()) {
        const serverRoot =
          process.env.OREWIRE_SERVER_PATH || path.resolve(__dirname, '../../../../Server');
        const { TaskStoppedError } = require(path.join(serverRoot, 'relay/task-cancel'));
        throw new TaskStoppedError();
      }
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
        if (err?.name === 'TaskStoppedError') throw err;
        // An unsolved bot wall blocks every remaining company — abort the batch
        // rather than churn through them all hitting the same wall.
        if (err?.name === 'CaptchaRequiredError') throw err;
        // A dead browser/page fails identically for every remaining company —
        // abort so the caller can fail over to a freshly respawned worker.
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('browser has been closed')
          || msg.includes('target page, context or browser has been closed')
          || msg.includes('target closed')) {
          throw err;
        }
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
          await relayIdleGap(workerId, breakMin, breakMax, shouldStop);
        } else {
          await relayIdleGap(workerId, delay, delay + jitter, shouldStop);
        }
      }
    }
    return out;
  });
}

module.exports = { runTransferAgentBatchOnSession };
