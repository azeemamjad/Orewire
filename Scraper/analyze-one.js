require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { analyzePdf } = require('./src/modules/analyzer');

const pdfPath  = process.argv[2];
const metaJson = process.argv[3];

if (!pdfPath) {
  console.error('Usage: node analyze-one.js <pdf-path> [meta-json]');
  process.exit(1);
}

const meta = metaJson ? JSON.parse(metaJson) : {};

analyzePdf(pdfPath, meta)
  .then(analysis => {
    const outPath = pdfPath.replace(/\.pdf$/i, '_analysis.json');
    fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
    console.log(JSON.stringify({ ok: true, pdfPath, outPath, verdict: analysis.verdict }));
  })
  .catch(err => {
    console.log(JSON.stringify({ ok: false, pdfPath, error: err.message }));
    process.exit(1);
  });