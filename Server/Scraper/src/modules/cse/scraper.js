const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { withBrowserSession } = require('../../utils/browser-session');

const CSE_URL = 'https://thecse.com/industry/mining/';

// Primary XPath for the download menu button (headlessUI ID — try first)
const MENU_BTN_XPATH = '//*[@id="headlessui-menu-button-:Rp6dl5m:"]';

async function downloadCseExcel(options = {}) {
  return withBrowserSession(
    'cse_seed',
    {
      relaySlot: options.relaySlot || 1,
      contextOptions: {
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    },
    async ({ page }) => {

    console.error('[CSE] Navigating to', CSE_URL);
    // Retry navigation up to 3 times
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(CSE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[CSE] Navigation attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (lastErr) throw lastErr;

    // Resolve the download menu button
    let menuBtn = page.locator(MENU_BTN_XPATH);
    if ((await menuBtn.count()) === 0) {
      console.error('[CSE] Exact ID not found — trying aria/text fallback');
      menuBtn = page.locator('button[aria-haspopup="true"]').first();
    }
    if ((await menuBtn.count()) === 0) {
      menuBtn = page.getByRole('button', { name: /download|export/i }).first();
    }

    await menuBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.error('[CSE] Clicking download menu button…');
    await menuBtn.click();

    await page.waitForTimeout(600);

    let excelItem = page.locator('[role="menuitem"]').filter({ hasText: /excel|xlsx/i }).first();
    if ((await excelItem.count()) === 0) {
      excelItem = page.locator('[role="menu"] a, [role="menu"] button').first();
    }

    await excelItem.waitFor({ state: 'visible', timeout: 10000 });
    console.error('[CSE] Clicking Excel download item…');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      excelItem.click(),
    ]);

    const suggested = download.suggestedFilename() || `cse_mining_${Date.now()}.xlsx`;
    const savePath  = path.join(os.tmpdir(), suggested);
    await download.saveAs(savePath);
    console.error(`[CSE] Saved to: ${savePath}`);

    return savePath;
    }
  );
}

module.exports = { downloadCseExcel };