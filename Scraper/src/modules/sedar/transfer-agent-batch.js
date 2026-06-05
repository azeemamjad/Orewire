const { withBrowserSession } = require('../../utils/browser-session');
const { humanDelay } = require('../../utils/human');
const {
  buildContextOptions,
  loadCookies,
  saveCookies,
  STEALTH_INIT,
  scrapeTransferAgentForCompany,
} = require('./transfer-agent');
const { isNetworkError } = require('../../utils/proxy-fallback');

async function runTransferAgentBatchOnSession(companies, options = {}) {
  const taskSlug = options.taskSlug || 'sedar_transfer_agent';
  const delay = parseInt(process.env.TA_DELAY_MS || '2500', 10);

  return withBrowserSession(taskSlug, options, async ({ page, context }) => {
    if (process.env.OREWIRE_RELAY !== 'in-process') {
      await context.addInitScript(STEALTH_INIT);
    }
    await loadCookies(context);

    const out = [];
    let anySuccess = false;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      try {
        const ta = await scrapeTransferAgentForCompany(page, c.name);
        anySuccess = true;
        out.push({
          id: c.id ?? null,
          name: c.name,
          ticker: c.ticker ?? null,
          transfer_agent: ta || null,
        });
      } catch (err) {
        if (isNetworkError(err) && !anySuccess) throw err;
        out.push({
          id: c.id ?? null,
          name: c.name,
          ticker: c.ticker ?? null,
          transfer_agent: null,
          error: err.message,
        });
      }
      await saveCookies(context);
      if (i < companies.length - 1) await humanDelay(delay, delay + 1200);
    }
    return out;
  });
}

module.exports = { runTransferAgentBatchOnSession };
