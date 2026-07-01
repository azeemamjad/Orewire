require('dotenv').config();
const fs                   = require('fs');
const path                 = require('path');
const { scrapeSedar }      = require('./src/modules/sedar/scraper');
const { analyzeDirectory } = require('./src/modules/analyzer');

const args         = process.argv.slice(2);
const company      = args.find((a) => !a.startsWith('--'));
const noAnalyze    = args.includes('--no-analyze');
const analyzeOnly  = args.includes('--analyze-only');

if (!company) {
  console.error([
    'Usage:',
    '  node index.js "<Company Name>"                 — scrape + analyze',
    '  node index.js "<Company Name>" --no-analyze    — scrape only',
    '  node index.js "<Company Name>" --analyze-only  — analyze already-downloaded PDFs',
  ].join('\n'));
  process.exit(1);
}

async function main() {
  const downloadBase = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
  const companyDir   = path.join(downloadBase, company.replace(/[^\w\s-]/g, '_').trim());
  const meta         = { company_name: company, exchange: 'SEDAR+ (Canada)' };

  if (analyzeOnly) {
    if (!fs.existsSync(companyDir)) {
      console.error(`[ERROR] No downloads found for "${company}".`);
      console.error(`        Run without --analyze-only to scrape first.`);
      process.exit(1);
    }
    await analyzeDirectory(companyDir, meta);
    return;
  }

  await scrapeSedar(company);

  if (!noAnalyze) {
    await analyzeDirectory(companyDir, meta);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
