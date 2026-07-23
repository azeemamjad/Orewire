'use strict';

function preferHostedBrowserPost() {
  const v = String(process.env.HOSTED_BROWSER_POST || '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (String(process.env.X_BROWSER_PASSWORD || '').trim()) return true;
  const url = String(process.env.X_BROWSER_URL || process.env.HOSTED_BROWSER_URL || '').trim();
  return !!url;
}

module.exports = {
  preferHostedBrowserPost,
};
