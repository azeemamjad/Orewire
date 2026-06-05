require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { runTransferAgentBatchOnSession } = require('./src/modules/sedar/transfer-agent-batch');

// ---------------------------------------------------------------------------
// CLI:
//   node transfer-agents.js --input companies.json --output results.json
//   node transfer-agents.js "Company Name" ["Another Co"]
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

  const results = await runTransferAgentBatchOnSession(companies, {
    taskSlug: 'sedar_transfer_agent',
    relaySlot: parseInt(process.env.RELAY_SLOT || '1', 10),
  });

  for (const row of results) emitResult(row);

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
