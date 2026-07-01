require('dotenv').config();
const path = require('path');
const os   = require('os');
const { withBrowserSession } = require('../utils/browser-session');

const ASX_URL  = 'https://www.asx.com.au/markets/trade-our-cash-market/directory';
const DL_XPATH = '//*[@id="company_directory"]/div/div[1]/div[2]/div[2]/a';

async function downloadAsxCsv(options = {}) {
  return withBrowserSession(
    'asx_seed',
    {
      relaySlot: options.relaySlot || 1,
      contextOptions: {
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
        userAgent:
          process.env.USER_AGENT ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    },
    async ({ page }) => {

    console.error('[ASX] Navigating to', ASX_URL);
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(ASX_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[ASX] Navigation attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (lastErr) throw lastErr;

    // Locate the download link — primary: exact XPath; fallback: text/aria
    let dlLink = page.locator(DL_XPATH);
    if ((await dlLink.count()) === 0) {
      console.error('[ASX] XPath not found — trying text fallback');
      dlLink = page.getByRole('link', { name: /download|csv|excel|company list/i }).first();
    }

    await dlLink.waitFor({ state: 'visible', timeout: 20000 });
    console.error('[ASX] Clicking download link…');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      dlLink.click(),
    ]);

    const suggested = download.suggestedFilename() || `asx_companies_${Date.now()}.csv`;
    const savePath  = path.join(os.tmpdir(), suggested);
    await download.saveAs(savePath);
    console.error(`[ASX] Saved to: ${savePath}`);

    return savePath;
    }
  );
}

module.exports = { downloadAsxCsv };