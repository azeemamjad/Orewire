// Refresh live quotes for all companies (or a subset) and store on companies rows.
//
//   node scripts/refresh-company-quotes.js
//   node scripts/refresh-company-quotes.js --limit 50
//   node scripts/refresh-company-quotes.js --ticker SCZ --exchange TSXV
//   node scripts/refresh-company-quotes.js --concurrency 2 --delay 500

require('dotenv').config();

const { refreshCompanyQuotes } = require('../lib/company-quote-refresh');

function parseArgs(argv) {
  const args = {
    limit: null,
    exchange: null,
    ticker: null,
    concurrency: null,
    delayMs: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--limit') { args.limit = parseInt(next, 10); i++; }
    else if (a === '--exchange') { args.exchange = next; i++; }
    else if (a === '--ticker') { args.ticker = next; i++; }
    else if (a === '--concurrency') { args.concurrency = parseInt(next, 10); i++; }
    else if (a === '--delay') { args.delayMs = parseInt(next, 10); i++; }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  console.log('[refresh-company-quotes] options:', args);
  refreshCompanyQuotes({ ...args, reason: 'cli' })
    .then((summary) => {
      console.log('Summary:', summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal:', err.message || err);
      process.exit(1);
    });
}

module.exports = { refreshCompanyQuotes };
