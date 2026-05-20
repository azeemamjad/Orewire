require('dotenv').config();
const { downloadAsxCsv } = require('./src/modules/asx/scraper');

(async () => {
  try {
    const filePath = await downloadAsxCsv();
    process.stdout.write(JSON.stringify({ ok: true, path: filePath }) + '\n');
    process.exit(0);
  } catch (err) {
    console.error('[ASX] Fatal:', err.message);
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
    process.exit(1);
  }
})();
