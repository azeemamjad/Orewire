const { downloadCseExcel } = require('../cse/scraper');

async function runCseSeed() {
  const xlsxPath = await downloadCseExcel();
  return { ok: true, path: xlsxPath };
}

module.exports = { runCseSeed };
