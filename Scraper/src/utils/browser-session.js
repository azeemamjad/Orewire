const path = require('path');
const { withProxyFallback } = require('./proxy-fallback');

function useRelayInProcess() {
  return process.env.OREWIRE_RELAY === 'in-process';
}

function getRelaySession() {
  const serverRoot =
    process.env.OREWIRE_SERVER_PATH || path.resolve(__dirname, '../../../Server');
  return require(path.join(serverRoot, 'relay/session'));
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
  let callback = fn;

  if (typeof options === 'function') {
    callback = options;
  } else if (options) {
    slug = options.taskSlug || taskSlug;
    slot = options.relaySlot || 1;
    callback = fn;
  }

  if (useRelayInProcess()) {
    const { withRelaySession, relayWiringEnabled } = getRelaySession();
    if (relayWiringEnabled()) {
      return withRelaySession(slug, slot, callback);
    }
  }

  const ctxOpts = options?.contextOptions || {
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  };

  return withProxyFallback(async (browser) => {
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    try {
      return await callback({ page, context, browser, workerId: null });
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
