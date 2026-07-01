require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { scrapeAsxFilingsForCompany } = require('./src/modules/asx/filings-scraper');
const { analyzeDirectory }           = require('./src/modules/analyzer');

const args        = process.argv.slice(2);
const ticker      = args.find(a => !a.startsWith('--'));
const noAnalyze   = args.includes('--no-analyze');
const analyzeOnly = args.includes('--analyze-only');
const daysIdx     = args.indexOf('--days');
const daysBack    = daysIdx !== -1 ? (parseInt(args[daysIdx + 1], 10) || 30) : 30;

if (!ticker) {
  console.error([
    'Usage:',
    '  node asx-filings.js <TICKER>              — scrape recent announcements for one company',
    '',
    'Options:',
    '  --days <N>        days back to fetch (default: 30)',
    '  --no-analyze      skip AI analysis',
    '  --analyze-only    only analyze already-downloaded PDFs',
  ].join('\n'));
  process.exit(1);
}

async function main() {
  const downloadBase = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
  const t            = ticker.toUpperCase();
  const companyDir   = path.join(downloadBase, t);
  const meta         = { exchange: 'ASX', ticker: t, company_name: t };

  if (analyzeOnly) {
    if (!fs.existsSync(companyDir)) {
      console.error(`[ERROR] No downloads for "${t}". Run without --analyze-only first.`);
      process.exit(1);
    }
    await analyzeDirectory(companyDir, meta);
    return;
  }

  const results  = await scrapeAsxFilingsForCompany(t, { downloadDir: downloadBase, daysBack });
  const newCount = results.filter(r => !r.skipped).length;
  console.error(`[ASX] ${t}: ${newCount} new filing(s) downloaded (${daysBack}-day window)`);

  if (!noAnalyze && newCount > 0) {
    await analyzeDirectory(companyDir, meta);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    ticker:  t,
    total:   results.length,
    new:     newCount,
    skipped: results.filter(r => r.skipped).length,
  }) + '\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
