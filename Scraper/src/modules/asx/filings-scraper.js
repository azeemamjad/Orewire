require('dotenv').config();
const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const { withProxyFallback } = require('../../utils/proxy-fallback');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error',  (err) => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function cleanHeadline(raw) {
  return (raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\d+\s*pages?\s+[\d.]+\s*(KB|MB|GB)\s*$/i, '')
    .replace(/opens new window/gi, '')
    .trim();
}

// Parse "11 May 2026" or "11 May 2026 7:12am" → Date (null if unparseable)
function parseAsxDate(raw) {
  const m = (raw || '').match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (!m) return null;
  return new Date(`${m[2]} ${m[1]}, ${m[3]}`);
}

function formatDateTag(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Download one announcement PDF
//   Per-company pages return a direct CDN PDF URL (markitdigital.com).
//   Legacy /asx/v2/statistics/displayAnnouncement.do URLs still need the
//   agree-page click flow, so handle both.
// ---------------------------------------------------------------------------

async function downloadAnnouncement(context, href, ticker, dateTag, idsId, downloadDir) {
  // Strip the bogus "&v=undefined" suffix ASX sometimes appends
  const cleanHref = href.replace(/&v=undefined$/i, '');
  const annUrl    = cleanHref.startsWith('http') ? cleanHref : 'https://www.asx.com.au' + cleanHref;

  const filename = `${ticker}_${dateTag}_${idsId}.pdf`;
  const savePath = path.join(downloadDir, filename);
  if (fs.existsSync(savePath)) {
    console.error(`[ASX] Already exists: ${filename}`);
    return { savePath, skipped: true };
  }

  // Direct CDN / PDF URL — download immediately
  const isDirectPdf = !annUrl.includes('asx.com.au/asx/v2/statistics/')
                   && (annUrl.includes('cdn-api.markitdigital.com')
                       || annUrl.includes('/asxpdf/')
                       || annUrl.toLowerCase().endsWith('.pdf'));
  if (isDirectPdf) {
    await downloadFile(annUrl, savePath);
    const size = fs.statSync(savePath).size;
    console.error(`[ASX] Saved (${Math.round(size / 1024)} KB): ${filename}`);
    return { savePath, skipped: false };
  }

  // Legacy agree-page flow
  const annPage = await context.newPage();
  try {
    await annPage.goto(annUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const agreeBtn = annPage.locator('input[value="Agree and proceed"]');
    if ((await agreeBtn.count()) > 0) {
      await agreeBtn.click();
      await annPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
    }

    const pdfUrl = annPage.url();
    if (!pdfUrl.includes('.pdf') && !pdfUrl.includes('/asxpdf/')) {
      console.error(`[ASX] Unexpected URL for ${idsId}: ${pdfUrl}`);
      return null;
    }

    await downloadFile(pdfUrl, savePath);
    const size = fs.statSync(savePath).size;
    console.error(`[ASX] Saved (${Math.round(size / 1024)} KB): ${filename}`);
    return { savePath, skipped: false };
  } finally {
    await annPage.close();
  }
}

// ---------------------------------------------------------------------------
// Scrape filings for one company using per-company announcements page
// ---------------------------------------------------------------------------

async function scrapeAsxFilingsForCompany(ticker, options = {}) {
  const {
    downloadDir = path.join(__dirname, '../../../downloads'),
    daysBack = 30,
  } = options;

  ticker = ticker.toUpperCase().trim();
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  return withProxyFallback(async (browser) => {
    const context = await browser.newContext({
      viewport:  { width: 1280, height: 900 },
      userAgent: process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const results = [];
    const page = await context.newPage();
    const url  = `https://www.asx.com.au/markets/trade-our-cash-market/announcements.${ticker.toLowerCase()}`;
    console.error(`[ASX] Loading announcements for ${ticker}…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Accept cookie consent banner if present (OneTrust — common on ASX)
    try {
      await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000, state: 'visible' });
      console.error('[ASX] Accepting cookie consent…');
      await page.click('#onetrust-accept-btn-handler');
      await page.waitForTimeout(1000);
    } catch { /* no banner — carry on */ }

    // Give the SPA time to hydrate and render the announcements table
    await page.waitForTimeout(5000);

    // Wait for the announcements table (verified XPath from live DOM probe)
    const tableXPath = '//*[@id="markets_announcements"]/div[1]/div[3]/table[1]';
    try {
      await page.waitForSelector(`xpath=${tableXPath}`, { timeout: 30000, state: 'visible' });
    } catch {
      // Diagnostics: check if the container at least loaded
      const hasSection = await page.locator('#markets_announcements').count();
      console.error(`[ASX] ${ticker}: table not found (markets_announcements present: ${hasSection > 0})`);
      if (!hasSection) {
        const snippet = (await page.content()).substring(0, 800);
        console.error(`[ASX] Page snippet: ${snippet}`);
      }
      return results;
    }

    const rows     = page.locator(`xpath=${tableXPath}/tbody/tr`);
    const rowCount = await rows.count();
    console.error(`[ASX] ${ticker}: ${rowCount} rows found`);

    if (rowCount === 0) return results;

    const companyDir = path.join(downloadDir, ticker);
    fs.mkdirSync(companyDir, { recursive: true });

    // Each row has 8 td cells (responsive duplicates):
    //  0: date+time  1: time (mobile)  2: code+name  3: name (mobile)
    //  4: price-sensitive  5: headline + PDF link  6: doc size  7: type
    for (let i = 0; i < rowCount; i++) {
      const row       = rows.nth(i);
      const tds       = row.locator('td');
      const cellCount = await tds.count();
      if (cellCount < 6) continue;

      const rawDate = (await tds.nth(0).textContent() || '').trim();
      const annDate = parseAsxDate(rawDate);
      if (annDate && annDate.getTime() < cutoff) {
        console.error(`[ASX] ${ticker}: skipping old row (${rawDate.split('\n')[0].trim()})`);
        continue;
      }

      // Find the headline link — try cell 5 first, then any cell with a link
      let link = tds.nth(5).locator('a').first();
      if ((await link.count()) === 0) link = row.locator('a[href*=".pdf"], a[href*="markitdigital"], a[href*="displayAnnouncement"]').first();
      if ((await link.count()) === 0) continue;

      const href = await link.getAttribute('href');
      if (!href) continue;

      const rawText   = (await link.textContent()) || '';
      const headline  = cleanHeadline(rawText);
      const priceSens = (await tds.nth(4).textContent() || '').trim();

      // Extract a stable ID from the href
      const cleanHref = href.replace(/&v=undefined$/i, '');
      const idsId = cleanHref.match(/idsId=([^&]+)/)?.[1]
                 ?? cleanHref.match(/\/file\/([^/?&]+)/)?.[1]
                 ?? cleanHref.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '_')
                 ?? `${Date.now()}_${i}`;
      const dateTag = annDate ? formatDateTag(annDate) : Date.now().toString();

      try {
        console.error(`[ASX] ${ticker}: ${headline.substring(0, 60)}`);
        const r = await downloadAnnouncement(context, href, ticker, dateTag, idsId, companyDir);
        if (r) results.push({ ticker, headline, date: rawDate, priceSens, ...r });
      } catch (err) {
        console.error(`[ASX] Error on ${idsId}: ${err.message}`);
      }
    }
  });
}

module.exports = { scrapeAsxFilingsForCompany };
