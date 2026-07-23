'use strict';

function preferHostedBrowserPost() {
  const v = String(process.env.HOSTED_BROWSER_POST || '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  // If OreWire is pointed at the standalone x-browser service, prefer it.
  const url = String(process.env.X_BROWSER_URL || process.env.HOSTED_BROWSER_URL || '').trim();
  return !!url;
}

module.exports = {
  preferHostedBrowserPost,
};
