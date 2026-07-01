const path = require('path');
const { serverRoot } = require('../paths');
const { withProxyFallback } = require('./proxy-fallback');

function useRelayInProcess() {
  return process.env.OREWIRE_RELAY === 'in-process';
}

function getRelaySession() {
  return require(path.join(serverRoot(), 'relay/session'));
}

/**
 * Run browser work either on the OreWire Relay pool (in-process) or via local Playwright + proxy fallback.
 *
 * @param {string} taskSlug — browser_tasks.slug (e.g. sedar_filings, asx_filings)
 * @param {object} options
 * @param {number} [options.relaySlot] — 1-based worker slot within tier
 * @param {string} [options.taskSlug] — override task slug
 * @param {(session: { page, context, browser?, workerId? }) => Promise<any>} fn
 */
async function withBrowserSession(taskSlug, options, fn) {
  let slug = taskSlug;
  let slot = 1;
  let tier = null;
  let callback = fn;

  if (typeof options === 'function') {
    callback = options;
  } else if (options) {
    slug = options.taskSlug || taskSlug;
    slot = options.relaySlot || 1;
    tier = options.relayTier || null;
    callback = fn;
  }

  if (useRelayInProcess()) {
    const { withRelaySession, relayWiringEnabled } = getRelaySession();
    if (relayWiringEnabled()) {
      return withRelaySession(slug, slot, callback, { tier });
    }
  }

  const ctxOpts = options?.contextOptions || {
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  };

  // Best-effort captcha detection for the local path. There's no human to solve
  // it here, so the guard throws — surfacing the wall instead of silently
  // collecting empty results until the batch ends.
  let detectCaptchaOnPage = null;
  let CaptchaRequiredError = Error;
  try {
    ({ detectCaptchaOnPage, CaptchaRequiredError } = require(path.join(serverRoot(), 'relay/captcha')));
  } catch {
    /* relay module not reachable — guard becomes a no-op */
  }

  return withProxyFallback(async (browser) => {
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    const guardCaptcha = async () => {
      if (detectCaptchaOnPage && (await detectCaptchaOnPage(page))) {
        throw new CaptchaRequiredError(`Bot wall detected on ${page.url()} (local run — no human to solve)`);
      }
    };
    try {
      return await callback({ page, context, browser, workerId: null, guardCaptcha });
    } finally {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
  });
}

module.exports = { withBrowserSession, useRelayInProcess };
