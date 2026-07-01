const { downloadAsxCsv } = require('../asx/scraper');

async function runAsxSeed() {
  const filePath = await downloadAsxCsv();
  return { ok: true, path: filePath };
}

module.exports = { runAsxSeed };
