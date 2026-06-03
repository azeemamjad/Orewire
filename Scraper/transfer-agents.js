require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { withProxyFallback, isNetworkError } = require('./src/utils/proxy-fallback');
const { humanDelay } = require('./src/utils/human');
const {
  buildContextOptions,
  loadCookies,
  saveCookies,
  STEALTH_INIT,
  scrapeTransferAgentForCompany,
} = require('./src/modules/sedar/transfer-agent');

// ---------------------------------------------------------------------------
// CLI:
//   node transfer-agents.js --input companies.json --output results.json
//   node transfer-agents.js "Company Name" ["Another Co"]   (ad-hoc, prints JSON)
//
// Input JSON: [{ "id": 1, "name": "Trigon Metals Inc.", "ticker": "TM", "exchange": "TSXV" }, ...]
// Output JSON: [{ "id": 1, "name": "...", "ticker": "...", "transfer_agent": "..."|null, "error": "..."? }, ...]
// ---------------------------------------------------------------------------

const TA_RESULT_MARKER = '__OREWIRE_TA_RESULT__';

function parseArgs(argv) {
  const out = { input: null, output: null, names: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') out.input = argv[++i];
    else if (argv[i] === '--output') out.output = argv[++i];
    else if (!argv[i].startsWith('--')) out.names.push(argv[i]);
  }
  return out;
}

function loadCompanies(args) {
  if (args.input) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  }
  return args.names.map((name, i) => ({ id: null, name, ticker: null, exchange: null }));
}

function emitResult(row) {
  console.error(`${TA_RESULT_MARKER}${JSON.stringify(row)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const companies = loadCompanies(args);
  if (companies.length === 0) {
    console.error('No companies to process. Pass --input <file.json> or company names.');
    process.exit(1);
  }

  const delay = parseInt(process.env.TA_DELAY_MS || '2500', 10);

  // Results are built inside the proxy-fallback fn so a tier switch starts clean.
  const results = await withProxyFallback(async (browser) => {
    const out = [];
    let anySuccess = false;
    const context = await browser.newContext(buildContextOptions());
    await context.addInitScript(STEALTH_INIT);
    await loadCookies(context);
    const page = await context.newPage();

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      const tag = `[${i + 1}/${companies.length}] ${c.exchange || ''}:${c.ticker || ''} ${c.name}`;
      try {
        const ta = await scrapeTransferAgentForCompany(page, c.name);
        anySuccess = true;
        const row = { id: c.id ?? null, name: c.name, ticker: c.ticker ?? null, transfer_agent: ta || null };
        out.push(row);
        emitResult(row);
        console.error(`${tag} — ${ta ? `TA: ${ta}` : 'no transfer agent found'}`);
      } catch (err) {
        // If this proxy tier can't reach SEDAR+ at all (and nothing has worked
        // yet), bubble the error so withProxyFallback switches tiers instead of
        // hammering every company on a dead proxy.
        if (isNetworkError(err) && !anySuccess) {
          console.error(`${tag} — proxy unreachable (${err.message}); switching proxy tier…`);
          throw err;
        }
        const row = { id: c.id ?? null, name: c.name, ticker: c.ticker ?? null, transfer_agent: null, error: err.message };
        out.push(row);
        emitResult(row);
        console.error(`${tag} — ERROR: ${err.message}`);
      }
      await saveCookies(context);
      if (i < companies.length - 1) await humanDelay(delay, delay + 1200);
    }
    return out;
  });

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), JSON.stringify(results, null, 2));
    console.error(`Wrote ${results.length} result(s) to ${args.output}`);
  } else {
    process.stdout.write(JSON.stringify(results, null, 2));
  }
}

main().catch((err) => {
  console.error('[transfer-agents] Fatal:', err.message);
  process.exit(1);
});
