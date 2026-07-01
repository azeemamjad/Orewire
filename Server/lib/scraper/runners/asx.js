const fs = require('fs');
const path = require('path');
const { scrapeAsxFilingsForCompany } = require('../asx/filings-scraper');
const { analyzeDirectory } = require('../analyzer');
const { DOWNLOADS_DIR } = require('../paths');

/**
 * @param {string} ticker
 * @param {{ noAnalyze?: boolean, analyzeOnly?: boolean, daysBack?: number, relaySlot?: number, taskSlug?: string }} opts
 */
async function runAsxDownload(ticker, opts = {}) {
  const t = ticker.toUpperCase();
  const companyDir = path.join(DOWNLOADS_DIR, t);
  const meta = { exchange: 'ASX', ticker: t, company_name: t };

  if (opts.analyzeOnly) {
    if (!fs.existsSync(companyDir)) {
      throw new Error(`No downloads for "${t}"`);
    }
    await analyzeDirectory(companyDir, meta);
    return { ok: true, ticker: t, analyzed: true };
  }

  const daysBack = opts.daysBack || 30;
  const results = await scrapeAsxFilingsForCompany(t, {
    downloadDir: DOWNLOADS_DIR,
    daysBack,
    relaySlot: opts.relaySlot,
    taskSlug: opts.taskSlug || 'asx_filings',
  });
  const newCount = results.filter((r) => !r.skipped).length;

  if (!opts.noAnalyze && newCount > 0) {
    await analyzeDirectory(companyDir, meta);
  }

  return {
    ok: true,
    ticker: t,
    total: results.length,
    new: newCount,
    skipped: results.filter((r) => r.skipped).length,
  };
}

module.exports = { runAsxDownload };
