#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { applyScraperEnv, restoreScraperEnv } = require('../lib/scraper/env');
const { runAsxDownload } = require('../lib/scraper/runners/asx');

const args = process.argv.slice(2);
const ticker = args.find((a) => !a.startsWith('--'));
const noAnalyze = args.includes('--no-analyze');
const analyzeOnly = args.includes('--analyze-only');
const daysIdx = args.indexOf('--days');
const daysBack = daysIdx !== -1 ? (parseInt(args[daysIdx + 1], 10) || 30) : 30;

if (!ticker) {
  console.error('Usage: node scripts/scrape-asx-filings.js <TICKER> [--days N] [--no-analyze] [--analyze-only]');
  process.exit(1);
}

const saved = applyScraperEnv({ relay: false });
runAsxDownload(ticker, { noAnalyze, analyzeOnly, daysBack })
  .then((r) => {
    console.log(JSON.stringify(r));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => restoreScraperEnv(saved));
