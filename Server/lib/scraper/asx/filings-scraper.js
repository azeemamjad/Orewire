require('dotenv').config();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const { withBrowserSession } = require('../utils/browser-session');
const { DOWNLOADS_DIR } = require('../paths');

const ASX_API = 'https://asx.api.markitdigital.com/asx-research/1.0';
const ASX_PDF_BASE =
  'https://cdn-api.markitdigital.com/apiman-gateway/ASX/asx-research/1.0/file/';
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto
      .get(url, { headers: { 'User-Agent': UA, Referer: 'https://www.asx.com.au/' } }, (res) => {
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
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    file.on('finish', () => file.close(resolve));
    file.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
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

function pdfUrlForAnnouncement(item) {
  const href = (item.url || '').replace(/&v=undefined$/i, '');
  if (href) {
    return href.startsWith('http') ? href : `https://www.asx.com.au${href}`;
  }
  if (item.documentKey) {
    return `${ASX_PDF_BASE}${item.documentKey}`;
  }
  return null;
}

function idsIdFromItem(item, href, index) {
  const key = item.documentKey || '';
  if (key) return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanHref = (href || '').replace(/&v=undefined$/i, '');
  return (
    cleanHref.match(/idsId=([^&]+)/)?.[1] ??
    cleanHref.match(/\/file\/([^/?&]+)/)?.[1] ??
    cleanHref.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '_') ??
    `${Date.now()}_${index}`
  );
}

function useBrowserFilings() {
  return process.env.ASX_FILINGS_BROWSER === '1' || process.env.ASX_FILINGS_BROWSER === 'true';
}

// ---------------------------------------------------------------------------
// Download one announcement PDF
// ---------------------------------------------------------------------------

async function downloadAnnouncement(context, href, ticker, dateTag, idsId, downloadDir) {
  const cleanHref = href.replace(/&v=undefined$/i, '');
  const annUrl = cleanHref.startsWith('http') ? cleanHref : 'https://www.asx.com.au' + cleanHref;

  const filename = `${ticker}_${dateTag}_${idsId}.pdf`;
  const savePath = path.join(downloadDir, filename);
  if (fs.existsSync(savePath)) {
    console.error(`[ASX] Already exists: ${filename}`);
    return { savePath, skipped: true };
  }

  const isDirectPdf =
    !annUrl.includes('asx.com.au/asx/v2/statistics/') &&
    (annUrl.includes('cdn-api.markitdigital.com') ||
      annUrl.includes('/asxpdf/') ||
      annUrl.toLowerCase().endsWith('.pdf') ||
      /\/file\/[^/?&]+$/i.test(annUrl));

  if (isDirectPdf) {
    await downloadFile(annUrl, savePath);
    const size = fs.statSync(savePath).size;
    console.error(`[ASX] Saved (${Math.round(size / 1024)} KB): ${filename}`);
    return { savePath, skipped: false };
  }

  if (!context) {
    throw new Error(`No browser context for legacy ASX URL: ${annUrl}`);
  }

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
// Preferred path: Markit HTTP API (no Playwright / Relay DC)
// ASX.com.au blocks many datacenter proxies; Markit CDN remains reachable.
// ---------------------------------------------------------------------------

async function fetchAsxAnnouncementItems(ticker, { count = 100 } = {}) {
  const url = `${ASX_API}/companies/${encodeURIComponent(ticker)}/announcements?count=${count}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://www.asx.com.au/',
      Origin: 'https://www.asx.com.au',
    },
  });
  if (!resp.ok) throw new Error(`ASX announcements HTTP ${resp.status}`);
  const json = await resp.json();
  return json?.data?.items || [];
}

async function scrapeAsxFilingsViaHttp(ticker, { downloadDir, daysBack }) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const results = [];

  console.error(`[ASX] Fetching announcements for ${ticker} via Markit API…`);
  const items = await fetchAsxAnnouncementItems(ticker, { count: 100 });
  console.error(`[ASX] ${ticker}: ${items.length} announcement(s) from API`);

  const companyDir = path.join(downloadDir, ticker);
  fs.mkdirSync(companyDir, { recursive: true });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const annDate = item.date ? new Date(item.date) : null;
    if (annDate && !Number.isNaN(annDate.getTime()) && annDate.getTime() < cutoff) {
      console.error(`[ASX] ${ticker}: skipping old row (${annDate.toISOString().slice(0, 10)})`);
      continue;
    }

    const href = pdfUrlForAnnouncement(item);
    if (!href) {
      console.error(`[ASX] ${ticker}: row ${i} has no documentKey/url`);
      continue;
    }

    const headline = cleanHeadline(item.headline || '');
    const priceSens = item.isPriceSensitive ? 'yes' : 'no';
    const idsId = idsIdFromItem(item, href, i);
    const dateTag = annDate && !Number.isNaN(annDate.getTime()) ? formatDateTag(annDate) : Date.now().toString();
    const rawDate = annDate && !Number.isNaN(annDate.getTime()) ? annDate.toISOString() : '';

    try {
      console.error(`[ASX] ${ticker}: ${headline.substring(0, 60)}`);
      const r = await downloadAnnouncement(null, href, ticker, dateTag, idsId, companyDir);
      if (r) results.push({ ticker, headline, date: rawDate, priceSens, ...r });
    } catch (err) {
      console.error(`[ASX] Error on ${idsId}: ${err.message}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Legacy browser scrape (Relay DC often cannot reach asx.com.au)
// ---------------------------------------------------------------------------

async function scrapeAsxFilingsOnPage(page, context, ticker, { downloadDir, daysBack }) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const results = [];
  const url = `https://www.asx.com.au/markets/trade-our-cash-market/announcements.${ticker.toLowerCase()}`;
  console.error(`[ASX] Loading announcements for ${ticker}…`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000, state: 'visible' });
    console.error('[ASX] Accepting cookie consent…');
    await page.click('#onetrust-accept-btn-handler');
    await page.waitForTimeout(1000);
  } catch {
    /* no banner */
  }

  const tableXPath = '//*[@id="markets_announcements"]/div[1]/div[3]/table[1]';
  const pdfLinkSel =
    'a[href*="markitdigital"], a[href*=".pdf"], a[href*="displayAnnouncement"], a[href*="/asxpdf/"]';
  try {
    await page.waitForSelector(`xpath=${tableXPath}`, { timeout: 30000, state: 'visible' });
    await page.waitForSelector(`#markets_announcements table tbody tr ${pdfLinkSel}`, {
      timeout: 30000,
      state: 'attached',
    });
    await page.waitForTimeout(1500);
  } catch {
    const hasSection = await page.locator('#markets_announcements').count();
    console.error(`[ASX] ${ticker}: table not found (markets_announcements present: ${hasSection > 0})`);
    if (!hasSection) {
      const snippet = (await page.content()).substring(0, 800);
      console.error(`[ASX] Page snippet: ${snippet}`);
    }
    return results;
  }

  const rows = page.locator(`xpath=${tableXPath}/tbody/tr`);
  const rowCount = await rows.count();
  console.error(`[ASX] ${ticker}: ${rowCount} rows found`);
  if (rowCount === 0) return results;

  const companyDir = path.join(downloadDir, ticker);
  fs.mkdirSync(companyDir, { recursive: true });

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const tds = row.locator('td');
    const cellCount = await tds.count();
    if (cellCount < 5) {
      console.error(`[ASX] ${ticker}: row ${i} has ${cellCount} cells, skipping`);
      continue;
    }

    const rawDate = (await tds.nth(0).textContent() || '').trim();
    const annDate = parseAsxDate(rawDate);
    if (annDate && annDate.getTime() < cutoff) {
      console.error(`[ASX] ${ticker}: skipping old row (${rawDate.split('\n')[0].trim()})`);
      continue;
    }

    let link = row.locator(pdfLinkSel).first();
    if ((await link.count()) === 0) {
      console.error(`[ASX] ${ticker}: row ${i} has no PDF link (${rawDate.split('\n')[0].trim() || 'no date'})`);
      continue;
    }

    const href = await link.getAttribute('href');
    if (!href || href.startsWith('javascript:')) {
      console.error(`[ASX] ${ticker}: row ${i} bad href`);
      continue;
    }

    const rawText = (await link.textContent()) || '';
    const headline = cleanHeadline(rawText);
    const priceSens = (await tds.nth(4).textContent() || '').trim();

    const cleanHref = href.replace(/&v=undefined$/i, '');
    const idsId =
      cleanHref.match(/idsId=([^&]+)/)?.[1] ??
      cleanHref.match(/\/file\/([^/?&]+)/)?.[1] ??
      cleanHref.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '_') ??
      `${Date.now()}_${i}`;
    const dateTag = annDate ? formatDateTag(annDate) : Date.now().toString();

    try {
      console.error(`[ASX] ${ticker}: ${headline.substring(0, 60)}`);
      const r = await downloadAnnouncement(context, href, ticker, dateTag, idsId, companyDir);
      if (r) results.push({ ticker, headline, date: rawDate, priceSens, ...r });
    } catch (err) {
      console.error(`[ASX] Error on ${idsId}: ${err.message}`);
    }
  }

  return results;
}

async function scrapeAsxFilingsViaBrowser(ticker, options = {}) {
  const {
    downloadDir = DOWNLOADS_DIR,
    daysBack = 30,
    relaySlot = 1,
    taskSlug = 'asx_filings',
  } = options;

  return withBrowserSession(
    taskSlug,
    {
      relaySlot,
      contextOptions: {
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
        userAgent: UA,
      },
    },
    async ({ page, context }) =>
      scrapeAsxFilingsOnPage(page, context, ticker, { downloadDir, daysBack })
  );
}

async function scrapeAsxFilingsForCompany(ticker, options = {}) {
  const {
    downloadDir = DOWNLOADS_DIR,
    daysBack = 30,
  } = options;

  ticker = ticker.toUpperCase().trim();

  if (useBrowserFilings()) {
    return scrapeAsxFilingsViaBrowser(ticker, options);
  }

  try {
    return await scrapeAsxFilingsViaHttp(ticker, { downloadDir, daysBack });
  } catch (err) {
    console.error(`[ASX] HTTP filings failed (${err.message}); falling back to browser…`);
    return scrapeAsxFilingsViaBrowser(ticker, options);
  }
}

module.exports = {
  scrapeAsxFilingsForCompany,
  scrapeAsxFilingsViaHttp,
  fetchAsxAnnouncementItems,
};
