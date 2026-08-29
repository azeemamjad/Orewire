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

  // NOTE: contextOptions from callers is deliberately ignored now. The engine
  // owns viewport (must be null so innerWidth tracks the real window), UA (never
  // overridden), and locale/timezone (matched to the proxy exit IP). Re-applying
  // a caller's viewport/UA/headers here is what made the local path detectable.

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

  return withProxyFallback(async ({ context, page }) => {
    const guardCaptcha = async () => {
      if (detectCaptchaOnPage && (await detectCaptchaOnPage(page))) {
        throw new CaptchaRequiredError(`Bot wall detected on ${page.url()} (local run — no human to solve)`);
      }
    };
    // The context's lifetime is owned by withProxyFallback, which closes it per
    // tier attempt — closing it here would break the fallback to the next tier.
    return callback({ page, context, browser: null, workerId: null, guardCaptcha });
  });
}

module.exports = { withBrowserSession, useRelayInProcess };
