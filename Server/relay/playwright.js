/**
 * Legacy accessor kept for callers that just want a chromium namespace
 * (admin proxy tests, scripts/test-relay-proxies.js).
 *
 * It now returns the *patched* driver, so even these one-off launches avoid the
 * Runtime.enable leak. Anything that needs a properly configured relay browser
 * — real Chrome, persistent profile, geo-matched locale — should use
 * relay/engines instead of launching from here.
 */
const { getChromium } = require('./engines/driver');

module.exports = { getChromium };
