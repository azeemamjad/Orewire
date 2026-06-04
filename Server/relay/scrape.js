const path = require('path');
const { withRelaySession, relayWiringEnabled } = require('./session');

const SCRAPER_ROOT = path.resolve(process.env.SCRAPER_PATH || path.join(__dirname, '../../Scraper'));

const RELAY_ENV_KEYS = ['OREWIRE_RELAY', 'OREWIRE_SERVER_PATH', 'HEADLESS', 'DOWNLOAD_DIR', 'DOWNLOADS_DIR'];

/** Same folder pipeline + admin use (Scraper/downloads by default). */
function resolveDownloadsDir() {
  return path.resolve(
    process.env.DOWNLOADS_DIR || path.join(SCRAPER_ROOT, 'downloads')
  );
}

function scraperEnv() {
  const downloadsDir = resolveDownloadsDir();
  return {
    OREWIRE_RELAY: 'in-process',
    OREWIRE_SERVER_PATH: path.join(__dirname, '..'),
    HEADLESS: process.env.RELAY_HEADLESS !== 'false' ? 'true' : 'false',
    DOWNLOAD_DIR: downloadsDir,
    DOWNLOADS_DIR: downloadsDir,
  };
}

function applyScraperEnv() {
  const saved = {};
  for (const k of RELAY_ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, scraperEnv());
  return saved;
}

function restoreScraperEnv(saved) {
  for (const k of RELAY_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function loadScraperModule(relPath) {
  const full = path.join(SCRAPER_ROOT, relPath);
  return require(full);
}

/**
 * Pipeline / admin: one company download via Relay pool.
 * @returns {Promise<number>} exit code 0|1
 */
async function runPipelineScrape(company, workerSlot, cfg = {}) {
  if (!relayWiringEnabled()) return null;

  const saved = applyScraperEnv();

  try {
    const isASX = company.exchange === 'ASX';
    if (isASX) {
      const { scrapeAsxFilingsForCompany } = loadScraperModule('src/modules/asx/filings-scraper');
      const ticker = company.ticker || company.name;
      await scrapeAsxFilingsForCompany(ticker, {
        downloadDir: resolveDownloadsDir(),
        daysBack: cfg.daysBack || 30,
        relaySlot: workerSlot,
        taskSlug: 'pipeline_asx_batch',
      });
    } else {
      const { scrapeSedar } = loadScraperModule('src/modules/sedar/scraper');
      await scrapeSedar(company.name, { relaySlot: workerSlot, taskSlug: 'pipeline_sedar_batch' });
    }
    return 0;
  } catch (err) {
    console.error(`[Relay scrape] ${company.ticker || company.name}: ${err.message}`);
    return 1;
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runSedarManual(companyName, slot = 1) {
  const saved = applyScraperEnv();
  try {
    const { scrapeSedar } = loadScraperModule('src/modules/sedar/scraper');
    return await scrapeSedar(companyName, { relaySlot: slot, taskSlug: 'sedar_manual' });
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runAsxManual(ticker, opts = {}) {
  const saved = applyScraperEnv();
  try {
    const { scrapeAsxFilingsForCompany } = loadScraperModule('src/modules/asx/filings-scraper');
    return await scrapeAsxFilingsForCompany(ticker, {
      ...opts,
      relaySlot: opts.relaySlot || 1,
      taskSlug: 'asx_manual',
    });
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runTransferAgentBatch(companies, slot = 1) {
  const saved = applyScraperEnv();
  try {
    const { runTransferAgentBatchOnSession } = loadScraperModule('src/modules/sedar/transfer-agent-batch');
    return await runTransferAgentBatchOnSession(companies, {
      relaySlot: slot,
      taskSlug: 'pipeline_transfer_agents',
    });
  } finally {
    restoreScraperEnv(saved);
  }
}

module.exports = {
  relayWiringEnabled,
  resolveDownloadsDir,
  runPipelineScrape,
  runSedarManual,
  runAsxManual,
  runTransferAgentBatch,
};
