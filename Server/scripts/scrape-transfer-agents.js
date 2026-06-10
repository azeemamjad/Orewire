// Transfer-agent pipeline for TSX / TSX-V companies.
// TMX Money doesn't publish transfer agents, so we scrape SEDAR+ issuer profiles
// with Playwright (in the Scraper project) and write the result back here.

require('dotenv').config();
const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const db = require('../db');
const { addLog } = require('../pipeline/state');
const {
  isJobRunning,
  syncJob,
  startJob,
  updateJobPid,
  endJob,
  isPidAlive,
} = require('../lib/job-tracker');

const SCRAPER_DIR = path.resolve(process.env.SCRAPER_PATH || path.join(__dirname, '../../Scraper'));
const TA_SCRIPT   = path.join(SCRAPER_DIR, 'transfer-agents.js');
const JOB_ID = 'transfer-agents';

let _childProc = null;
let _runActive = false;

function isRunning() {
  if (_runActive) return true;
  if (_childProc && _childProc.exitCode == null) return true;
  syncJob(JOB_ID);
  const job = require('../lib/job-tracker').getJob(JOB_ID);
  if (job?.status === 'running') {
    endJob(JOB_ID, 'stale');
    addLog('warn', '[TA] Cleared stale job record (process not attached to this server session)');
  }
  return false;
}

function stopTransferAgentScrape() {
  addLog('warn', '[TA] Stop requested');
  if (_childProc && _childProc.exitCode == null) {
    try {
      _childProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  const job = require('../lib/job-tracker').getJob(JOB_ID);
  if (job?.pid && job.pid !== process.pid && isPidAlive(job.pid)) {
    try {
      process.kill(job.pid);
    } catch {
      /* ignore */
    }
  }
  endJob(JOB_ID, 'stopped');
  _childProc = null;
}

async function fetchCompanies({ limit, ticker, all }) {
  const where = [
    "name IS NOT NULL",
    "ticker IS NOT NULL AND ticker <> ''",
    "UPPER(REPLACE(exchange, '-', '')) IN ('TSX', 'TSXV')",
  ];
  const params = [];
  if (ticker) { params.push(ticker); where.push(`UPPER(ticker) = UPPER($${params.length})`); }
  if (!all)   { where.push("(transfer_agent IS NULL OR transfer_agent = '')"); }

  const sql = `
    SELECT id, exchange, ticker, name
    FROM companies
    WHERE ${where.join(' AND ')}
    ORDER BY market_cap DESC NULLS LAST, id ASC
    ${limit ? `LIMIT ${parseInt(limit, 10)}` : ''}
  `;
  const r = await db.query(sql, params);
  return r.rows;
}

function workerEnv() {
  return { ...process.env, HEADLESS: 'true', TA_DEBUG: '1' };
}

const TA_RESULT_MARKER = '__OREWIRE_TA_RESULT__';

async function persistTaResult(row, dryRun, stats) {
  if (row.error) {
    stats.fail++;
    addLog('err', `[TA] ${row.ticker || row.name}: ${row.error}`);
    return;
  }
  if (!row.transfer_agent) {
    stats.miss++;
    addLog('out', `[TA] ${row.ticker || row.name}: no transfer agent found`);
    return;
  }
  if (dryRun || row.id == null) {
    stats.ok++;
    addLog('out', `[TA] ${row.ticker || row.name}: ${row.transfer_agent} (dry-run, not saved)`);
    return;
  }
  await db.query(
    `UPDATE companies SET transfer_agent = COALESCE($2, transfer_agent) WHERE id = $1`,
    [row.id, row.transfer_agent],
  );
  stats.ok++;
  addLog('out', `[TA] Saved ${row.ticker || row.name}: ${row.transfer_agent}`);
}

function handleScraperLine(line, dryRun, stats, pending) {
  const idx = line.indexOf(TA_RESULT_MARKER);
  if (idx !== -1) {
    try {
      const row = JSON.parse(line.slice(idx + TA_RESULT_MARKER.length));
      const job = persistTaResult(row, dryRun, stats).catch((err) => {
        stats.fail++;
        addLog('err', `[TA] Save failed for ${row.ticker || row.name}: ${err.message}`);
      });
      pending.push(job);
    } catch (err) {
      addLog('err', `[TA] Bad result payload: ${err.message}`);
    }
    return;
  }
  addLog('out', `[TA] ${line}`);
}

function attachScraperStreams(proc, dryRun) {
  const stats = { ok: 0, miss: 0, fail: 0 };
  const pending = [];
  let bufOut = '';
  let bufErr = '';

  const feed = (prev, chunk) => {
    const combined = prev + chunk;
    const lines = combined.split('\n');
    const rest = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) handleScraperLine(line, dryRun, stats, pending);
    }
    return rest;
  };

  proc.stdout.on('data', (d) => { bufOut = feed(bufOut, String(d)); });
  proc.stderr.on('data', (d) => { bufErr = feed(bufErr, String(d)); });

  return {
    stats,
    pending,
    flush() {
      if (bufOut.trim()) handleScraperLine(bufOut.trim(), dryRun, stats, pending);
      if (bufErr.trim()) handleScraperLine(bufErr.trim(), dryRun, stats, pending);
    },
  };
}

function useRelayScrapers() {
  return process.env.RELAY_ENABLED === 'true' && process.env.RELAY_WIRE_SCRAPERS !== 'false';
}

// Proxy/connectivity failure on the worker → worth retrying on the next tier.
// A captcha needs a human (no tier switch helps) and a code/selector bug isn't
// tier-related, so those propagate instead of silently burning all three tiers.
function isTierFallbackError(err) {
  if (!err) return false;
  if (err.name === 'CaptchaRequiredError') return false;
  if (err.name === 'NavigationBlockedError') return true;
  const m = (err.message || '').toLowerCase();
  return m.includes('407')
    || m.includes('proxy')
    || m.includes('traffic limit')
    || m.includes('tunnel')
    || m.includes('net::')
    || m.includes('econnrefused')
    || m.includes('econnreset')
    || m.includes('is not running')   // tier's worker not in the pool
    || m.includes('is busy');
}

// Try residential first (best for SEDAR+'s bot wall), then datacenter, then the
// server's own IP — so an exhausted/blocked proxy tier degrades gracefully
// instead of failing the whole run.
const RELAY_TIERS = [
  { tier: 'res',    label: 'residential' },
  { tier: 'dc',     label: 'datacenter' },
  { tier: 'direct', label: 'direct (local IP)' },
];

async function runScraperViaRelay(companies, dryRun) {
  const { runTransferAgentBatch } = require('../relay/scrape');
  const stats = { ok: 0, miss: 0, fail: 0 };
  const pending = [];
  const seen = new Set();
  // Persist + log each company AS it's scraped (not after the whole batch), so
  // results land in the DB incrementally and stopping mid-run keeps progress.
  const onResult = async (row, index, total) => {
    seen.add(index);
    const line = `${TA_RESULT_MARKER}${JSON.stringify(row)}`;
    handleScraperLine(line, dryRun, stats, pending);
    if ((index + 1) % 10 === 0) {
      addLog('out', `[TA] Progress ${index + 1}/${total} (saved=${stats.ok} no-agent=${stats.miss} errors=${stats.fail})`);
    }
  };

  let results = null;
  let lastErr = null;
  for (const { tier, label } of RELAY_TIERS) {
    try {
      addLog('out', `[TA] Using OreWire Relay — ${label} tier (worker ${tier}-1)`);
      results = await runTransferAgentBatch(companies, 1, onResult, tier);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!isTierFallbackError(err)) throw err;
      addLog('warn', `[TA] ${label} tier failed (${err.message}) — falling back to next tier`);
    }
  }
  if (lastErr) throw lastErr;

  // Safety net: if the batch returned rows the per-row hook never delivered
  // (e.g. an older Scraper build without onResult support), persist them here so
  // a multi-hour run is never silently discarded.
  results.forEach((row, index) => {
    if (seen.has(index)) return;
    addLog('warn', `[TA] Row ${index} not streamed via onResult — persisting from final results`);
    handleScraperLine(`${TA_RESULT_MARKER}${JSON.stringify(row)}`, dryRun, stats, pending);
  });
  await Promise.allSettled(pending);
  return { results, stats };
}

function runScraper(inputPath, outputPath, dryRun = false) {
  if (useRelayScrapers()) {
    const companies = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    return runScraperViaRelay(companies, dryRun);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [TA_SCRIPT, '--input', inputPath, '--output', outputPath], {
      cwd: SCRAPER_DIR,
      env: workerEnv(),
    });
    _childProc = proc;
    updateJobPid(JOB_ID, proc.pid);

    const streams = attachScraperStreams(proc, dryRun);

    proc.on('error', reject);
    proc.on('close', (code) => {
      _childProc = null;
      streams.flush();
      Promise.allSettled(streams.pending).then(() => {
        if (code !== 0) return reject(new Error(`Scraper exited with code ${code}`));
        try {
          const results = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
          resolve({ results, stats: streams.stats });
        } catch (e) {
          reject(new Error(`Could not read scraper output: ${e.message}`));
        }
      });
    });
  });
}

async function runTransferAgentScrape(opts = {}) {
  syncJob(JOB_ID);
  if (isJobRunning(JOB_ID)) {
    const err = new Error('Transfer-agent scrape already running');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }

  const args = {
    limit: opts.limit != null ? Number(opts.limit) : null,
    ticker: opts.ticker || null,
    all: !!opts.all,
    dryRun: !!opts.dryRun,
  };

  _runActive = true;
  startJob(JOB_ID, {
    label: 'Transfer-agent scrape (SEDAR+)',
    pid: process.pid,
    type: 'scraper',
    meta: args,
  });

  addLog('out', `[TA] Starting SEDAR+ transfer-agent scrape (TSX/TSX-V): ${JSON.stringify(args)}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orewire-ta-'));
  const inputPath  = path.join(tmpDir, 'companies.json');
  const outputPath = path.join(tmpDir, 'results.json');

  try {
    const companies = await fetchCompanies(args);
    addLog('out', `[TA] ${companies.length} companies queued`);
    if (companies.length === 0) {
      endJob(JOB_ID, 'completed');
      return { total: 0, ok: 0, miss: 0, fail: 0 };
    }

    fs.writeFileSync(inputPath, JSON.stringify(companies));
    const { results, stats } = await runScraper(inputPath, outputPath, args.dryRun);

    addLog('out', `[TA] Done. saved=${stats.ok} no-agent=${stats.miss} errors=${stats.fail} total=${results.length}`);
    endJob(JOB_ID, 'completed');
    return { total: results.length, ok: stats.ok, miss: stats.miss, fail: stats.fail };
  } catch (err) {
    endJob(JOB_ID, 'failed');
    throw err;
  } finally {
    _runActive = false;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    _childProc = null;
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { all: argv.includes('--all'), dryRun: argv.includes('--dry-run') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--ticker') opts.ticker = argv[++i];
  }
  runTransferAgentScrape(opts)
    .then((s) => { console.log('\nSummary:', s); process.exit(0); })
    .catch((e) => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = { runTransferAgentScrape, isRunning, stopTransferAgentScrape };
