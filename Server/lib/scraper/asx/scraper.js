require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { withBrowserSession } = require('../utils/browser-session');

const ASX_URL = 'https://www.asx.com.au/markets/trade-our-cash-market/directory';
const DL_XPATH = '//*[@id="company_directory"]/div/div[1]/div[2]/div[2]/a';

// Public Markit endpoint used by the ASX company directory "Download" control.
// Override with ASX_DIRECTORY_CSV_URL if ASX rotates the token/path.
const DEFAULT_ASX_CSV_URL =
  'https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file?access_token=83ff96335c2d45a094df02a206a39ff4';

function asxCsvUrl() {
  return (process.env.ASX_DIRECTORY_CSV_URL || DEFAULT_ASX_CSV_URL).trim();
}

function looksLikeAsxCsv(buf) {
  const head = buf.slice(0, 200).toString('utf8');
  return /ASX code/i.test(head) && /Company name/i.test(head);
}

/**
 * Preferred path: direct HTTP download (no Playwright / proxies).
 * The directory page download button hits this Markit CSV endpoint.
 */
async function downloadAsxCsvHttp() {
  const url = asxCsvUrl();
  console.error('[ASX] Downloading company directory CSV via HTTP…');
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/csv,*/*',
      Referer: 'https://www.asx.com.au/',
      Origin: 'https://www.asx.com.au',
    },
  });
  if (!resp.ok) throw new Error(`ASX CSV HTTP ${resp.status}`);

  const buf = Buffer.from(await resp.arrayBuffer());
  if (!looksLikeAsxCsv(buf)) {
    throw new Error('ASX CSV response did not look like the company directory file');
  }

  const savePath = path.join(os.tmpdir(), `ASX_Listed_Companies_${Date.now()}.csv`);
  fs.writeFileSync(savePath, buf);
  console.error(`[ASX] Saved ${buf.length} bytes to: ${savePath}`);
  return savePath;
}

async function downloadAsxCsvBrowser(options = {}) {
  return withBrowserSession(
    'asx_seed',
    {
      relaySlot: options.relaySlot || 1,
      // NOTE: ignored since the engine rework — relay/engines owns the context.
      // See Server/relay/README.md.
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
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (lastErr) throw lastErr;

      try {
        await page.click('#onetrust-accept-btn-handler', { timeout: 5000 });
      } catch {
        /* no banner */
      }

      let dlLink = page.locator(DL_XPATH);
      if ((await dlLink.count()) === 0) {
        console.error('[ASX] XPath not found — trying text/href fallback');
        dlLink = page
          .locator(
            'a[href*="directory/file"], a[href*="ASXListed"], a[download*="csv"], a[href*=".csv"]'
          )
          .first();
      }
      if ((await dlLink.count()) === 0) {
        dlLink = page.getByRole('link', { name: /download/i }).first();
      }

      await dlLink.waitFor({ state: 'visible', timeout: 20000 });
      console.error('[ASX] Clicking download link…');

      const href = await dlLink.getAttribute('href');
      if (href && /directory\/file|\.csv/i.test(href)) {
        const abs = href.startsWith('http') ? href : new URL(href, ASX_URL).toString();
        const resp = await page.request.get(abs, {
          headers: { Referer: ASX_URL, Accept: 'text/csv,*/*' },
        });
        if (!resp.ok()) throw new Error(`ASX CSV browser HTTP ${resp.status()}`);
        const buf = Buffer.from(await resp.body());
        if (!looksLikeAsxCsv(buf)) {
          throw new Error('ASX CSV browser response did not look like the company directory file');
        }
        const savePath = path.join(os.tmpdir(), `ASX_Listed_Companies_${Date.now()}.csv`);
        fs.writeFileSync(savePath, buf);
        console.error(`[ASX] Saved ${buf.length} bytes to: ${savePath}`);
        return savePath;
      }

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        dlLink.click(),
      ]);

      const suggested = download.suggestedFilename() || `asx_companies_${Date.now()}.csv`;
      const savePath = path.join(os.tmpdir(), suggested);
      await download.saveAs(savePath);
      console.error(`[ASX] Saved to: ${savePath}`);
      return savePath;
    }
  );
}

async function downloadAsxCsv(options = {}) {
  try {
    return await downloadAsxCsvHttp();
  } catch (httpErr) {
    console.error(`[ASX] HTTP download failed (${httpErr.message}); falling back to browser…`);
    return downloadAsxCsvBrowser(options);
  }
}

module.exports = { downloadAsxCsv, downloadAsxCsvHttp };
