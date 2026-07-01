const path = require('path');

let _chromium;

function getChromium() {
  if (_chromium) return _chromium;
  _chromium = require('playwright').chromium;
  return _chromium;
}

module.exports = { getChromium };
