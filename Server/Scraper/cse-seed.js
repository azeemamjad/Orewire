require('dotenv').config();
const { downloadCseExcel } = require('./src/modules/cse/scraper');

// Downloads the CSE mining XLSX and prints the temp file path to stdout as JSON.
// Stderr is used for progress logging (displayed in the server's log box).
// Exit 0 = success, exit 1 = failure.

async function main() {
  const xlsxPath = await downloadCseExcel();
  // Output the path so the Server can parse + import it
  process.stdout.write(JSON.stringify({ ok: true, path: xlsxPath }) + '\n');
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
  process.exit(1);
});
