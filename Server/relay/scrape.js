const { relayWiringEnabled, applyScraperEnv, restoreScraperEnv } = require('../lib/scraper/env');
const { DOWNLOADS_DIR } = require('../lib/scraper/paths');
const { runSedarDownload } = require('../lib/scraper/runners/sedar');
const { runAsxDownload } = require('../lib/scraper/runners/asx');
const { runTransferAgentBatch } = require('../lib/scraper/runners/transfer-agents');

/**
 * Pipeline / admin: one company download via Relay pool or local Playwright.
 * @returns {Promise<number>} exit code 0|1
 */
async function runPipelineScrape(company, workerSlot, cfg = {}) {
  const saved = applyScraperEnv({ relay: relayWiringEnabled() });
  const isASX = company.exchange === 'ASX';

  try {
    if (isASX) {
      const ticker = company.ticker || company.name;
      await runAsxDownload(ticker, {
        noAnalyze: true,
        daysBack: cfg.daysBack || 30,
        relaySlot: workerSlot,
        taskSlug: 'pipeline_asx_batch',
      });
    } else {
      await runSedarDownload(company.name, {
        noAnalyze: true,
        relaySlot: workerSlot,
        taskSlug: 'pipeline_sedar_batch',
      });
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
  const saved = applyScraperEnv({ relay: relayWiringEnabled() });
  try {
    return await runSedarDownload(companyName, {
      relaySlot: slot,
      taskSlug: 'sedar_manual',
    });
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runAsxManual(ticker, opts = {}) {
  const saved = applyScraperEnv({ relay: relayWiringEnabled() });
  try {
    return await runAsxDownload(ticker, {
      ...opts,
      relaySlot: opts.relaySlot || 1,
      taskSlug: 'asx_manual',
    });
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runTransferAgentBatchRelay(companies, slot = 1, onResult = null, tier = null) {
  const saved = applyScraperEnv({ relay: relayWiringEnabled() });
  try {
    return await runTransferAgentBatch(companies, {
      relaySlot: slot,
      relayTier: tier,
      taskSlug: 'pipeline_transfer_agents',
      onResult,
    });
  } finally {
    restoreScraperEnv(saved);
  }
}

module.exports = {
  relayWiringEnabled,
  resolveDownloadsDir: () => DOWNLOADS_DIR,
  runPipelineScrape,
  runSedarManual,
  runAsxManual,
  runTransferAgentBatch: runTransferAgentBatchRelay,
};
