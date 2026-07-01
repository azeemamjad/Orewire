const path = require('path');

let _chromium;

function resolvePlaywrightRoot() {
  const scraperRoot = path.resolve(
    process.env.SCRAPER_PATH || path.join(__dirname, '../Scraper')
  );
  return path.join(scraperRoot, 'node_modules', 'playwright');
}

function getChromium() {
  if (_chromium) return _chromium;
  try {
    _chromium = require(resolvePlaywrightRoot()).chromium;
  } catch {
    _chromium = require('playwright').chromium;
  }
  return _chromium;
}

module.exports = { getChromium };
