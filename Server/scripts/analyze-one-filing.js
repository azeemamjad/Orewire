#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { applyScraperEnv, restoreScraperEnv } = require('../lib/scraper/env');
const { runAnalyzeOne } = require('../lib/scraper/runners/analyze-one');

const pdfPath = process.argv[2];
const metaJson = process.argv[3];

if (!pdfPath) {
  console.error('Usage: node scripts/analyze-one-filing.js <pdf-path> [meta-json]');
  process.exit(1);
}

const meta = metaJson ? JSON.parse(metaJson) : {};
const saved = applyScraperEnv({ relay: false });

runAnalyzeOne(pdfPath, meta)
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, pdfPath, error: err.message }));
    process.exit(1);
  })
  .finally(() => restoreScraperEnv(saved));
