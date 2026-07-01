const fs = require('fs');
const path = require('path');
const { scrapeSedar } = require('../sedar/scraper');
const { analyzeDirectory } = require('../analyzer');
const { DOWNLOADS_DIR } = require('../paths');

function companyDirName(company) {
  return company.replace(/[^\w\s-]/g, '_').trim();
}

/**
 * @param {string} companyName
 * @param {{ noAnalyze?: boolean, analyzeOnly?: boolean, relaySlot?: number, taskSlug?: string, onLog?: (line: string) => void }} opts
 */
async function runSedarDownload(companyName, opts = {}) {
  const dir = path.join(DOWNLOADS_DIR, companyDirName(companyName));
  const meta = { company_name: companyName, exchange: 'SEDAR+ (Canada)' };

  if (opts.analyzeOnly) {
    if (!fs.existsSync(dir)) {
      throw new Error(`No downloads found for "${companyName}"`);
    }
    await analyzeDirectory(dir, meta);
    return { ok: true, company: companyName, analyzed: true };
  }

  await scrapeSedar(companyName, {
    relaySlot: opts.relaySlot,
    taskSlug: opts.taskSlug || 'sedar_filings',
  });

  if (!opts.noAnalyze) {
    await analyzeDirectory(dir, meta);
  }

  return { ok: true, company: companyName };
}

module.exports = { runSedarDownload, companyDirName };
