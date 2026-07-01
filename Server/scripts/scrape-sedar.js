#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { applyScraperEnv, restoreScraperEnv } = require('../lib/scraper/env');
const { runSedarDownload } = require('../lib/scraper/runners/sedar');

const args = process.argv.slice(2);
const company = args.find((a) => !a.startsWith('--'));
const noAnalyze = args.includes('--no-analyze');
const analyzeOnly = args.includes('--analyze-only');

if (!company) {
  console.error('Usage: node scripts/scrape-sedar.js "<Company Name>" [--no-analyze] [--analyze-only]');
  process.exit(1);
}

const saved = applyScraperEnv({ relay: false });
runSedarDownload(company, { noAnalyze, analyzeOnly })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => restoreScraperEnv(saved));
