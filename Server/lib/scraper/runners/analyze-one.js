const fs = require('fs');
const path = require('path');
const { analyzePdf } = require('../analyzer');

/**
 * @param {string} pdfPath
 * @param {object} [meta]
 */
async function runAnalyzeOne(pdfPath, meta = {}) {
  const resolved = path.resolve(pdfPath);
  const analysis = await analyzePdf(resolved, meta);
  const outPath = resolved.replace(/\.pdf$/i, '_analysis.json');
  fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
  return { ok: true, pdfPath: resolved, outPath, verdict: analysis.verdict, analysis };
}

module.exports = { runAnalyzeOne };
