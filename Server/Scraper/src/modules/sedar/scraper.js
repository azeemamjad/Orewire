require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { humanDelay, humanClick, humanType, randomViewport, STEALTH_INIT } = require('../../utils/human');
const { withBrowserSession } = require('../../utils/browser-session');

const BASE_URL    = 'https://www.sedarplus.ca/home/';
const COOKIE_FILE = path.resolve(process.env.COOKIE_FILE || './data/cookies.json');

// ---------------------------------------------------------------------------
// Browser / context setup
// ---------------------------------------------------------------------------

function buildContextOptions() {
  const viewport = randomViewport();
  return {
    acceptDownloads: true,
    viewport,
    userAgent: process.env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale:     process.env.LOCALE     || 'en-US',
    timezoneId: process.env.TIMEZONE   || 'America/Toronto',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  };
}

// ---------------------------------------------------------------------------
// Cookie persistence
// ---------------------------------------------------------------------------

async function loadCookies(context) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    await context.addCookies(cookies);
    console.log('[SEDAR] Loaded saved cookies');
  }
}

async function saveCookies(context) {
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

async function goToDocumentsPage(page) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
  await humanDelay(800, 1500);

  const navTrigger = page.getByRole('link', { name: /search sedar/i }).first();
  await navTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await humanClick(page, navTrigger);

  await humanDelay(600, 1000);
  const docsLink = page.getByRole('link', { name: /^documents$/i }).first();
  await docsLink.waitFor({ state: 'visible', timeout: 10000 });
  await humanClick(page, docsLink);
}

async function navigateToDocumentsSearch(page, context) {
  await goToDocumentsPage(page);

  try {
    await page.waitForSelector('input[placeholder="Profile name or number"]', { state: 'visible', timeout: 30000 });
  } catch {
    // Session cookies expired — SEDAR+ redirected back to /home/.
    // Clear stale cookies and retry once with a fresh session.
    if (page.url().includes('/home/')) {
      console.log('[SEDAR] Session expired — clearing cookies and retrying…');
      await context.clearCookies();
      if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE);
      await goToDocumentsPage(page);
      await page.waitForSelector('input[placeholder="Profile name or number"]', { state: 'visible', timeout: 30000 });
    } else {
      throw new Error(`Documents search page did not load (URL: ${page.url()})`);
    }
  }

  await humanDelay(400, 700);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDDMMYYYY(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

// Fill a date input that uses jQuery UI datepicker (class "hasDatepicker").
// page.fill() + dispatchEvent('change') is enough to set the value and
// let the picker's validation pass without actually opening the calendar.
async function fillDateInput(page, selector, dateStr) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
  }, { sel: selector, val: dateStr });
}

// ---------------------------------------------------------------------------

async function searchCompany(page, companyName) {
  await humanType(page, page.locator('input[placeholder="Profile name or number"]'), companyName);

  await page.waitForSelector('ul.ui-autocomplete li.ui-menu-item', { state: 'visible', timeout: 15000 });
  await humanDelay(400, 800);

  const allItems = page.locator('ul.ui-autocomplete li.ui-menu-item');
  const itemCount = await allItems.count();

  // Pick best match: first item whose text includes the search string, else item [0]
  const needle = companyName.toLowerCase();
  let bestIdx = 0;
  for (let i = 0; i < itemCount; i++) {
    const text = (await allItems.nth(i).textContent()).trim().toLowerCase();
    if (text.includes(needle)) { bestIdx = i; break; }
  }
  const chosen = (await allItems.nth(bestIdx).textContent()).trim();
  console.log(`[SEDAR] Selecting: "${chosen}"`);

  // Click autocomplete item — fires serviceLookupSelected AJAX which sets the company
  // filter server-side but does NOT run the search yet.  Wait for that response.
  await Promise.all([
    page.waitForResponse(r => r.url().includes('update.html'), { timeout: 15000 }).catch(() => {}),
    allItems.nth(bestIdx).click(),
  ]);
  await humanDelay(600, 1000);

  // Fill date range: past month → today (format DD/MM/YYYY)
  const today    = new Date();
  const fromDate = new Date(today);
  fromDate.setMonth(fromDate.getMonth() - 1);
  const fromStr = formatDDMMYYYY(fromDate);
  const toStr   = formatDDMMYYYY(today);

  await fillDateInput(page, '#SubmissionDate',  fromStr);
  await fillDateInput(page, '#SubmissionDate2', toStr);
  console.log(`[SEDAR] Date range: ${fromStr} → ${toStr}`);
  await humanDelay(300, 500);

  // Trigger Search via JavaScript .click() — Playwright's coordinate-based mouse click
  // doesn't fire Trinidad's event handlers; JS click does.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent || '').trim().toLowerCase() === 'search');
    if (btn) btn.click();
  });

  // Wait for the search update.html response, then for the results table
  await page.waitForResponse(
    r => r.url().includes('update.html') || (r.url().includes('view.html') && r.url().includes('sedarplus')),
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForSelector('table.appTable', { state: 'visible', timeout: 30000 });
  await humanDelay(800, 1400);

  console.log(`[SEDAR] Results URL: ${page.url()}`);
  const resultCount = await page.locator('td.appTblCell2 a.appDocumentLink').count();
  console.log(`[SEDAR] Documents visible on page 1: ${resultCount}`);
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'document.pdf';
}

function filenameFromDisposition(cd, fallback) {
  const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\r\n]+)["']?/i);
  return safeFilename(m ? decodeURIComponent(m[1].trim()) : fallback);
}

async function downloadByFetch(page, href, destDir, fallbackName) {
  // Fetch the resource from within the page's JS context — preserves session,
  // cookies and referrer so the server accepts the request
  const result = await page.evaluate(async (url) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/pdf,*/*', Referer: window.location.href },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    const ct = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    return { bytes: Array.from(new Uint8Array(buf)), cd, ct };
  }, href);

  const filename = filenameFromDisposition(result.cd, fallbackName);
  const dest     = path.resolve(destDir, filename);
  console.log(`  → saving to: ${dest}`);
  fs.writeFileSync(dest, Buffer.from(result.bytes));
  return filename;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

// Next button XPath — node ID is dynamic so we also try a text fallback
const NEXT_XPATH    = '//*[@id="nodeW860"]/div[5]/div/div/div/div[11]/a';
const MAX_PAGES     = parseInt(process.env.MAX_PAGES || '50', 10);

async function getNextButton(page) {
  // Try the known XPath first
  const byXPath = page.locator(NEXT_XPATH);
  if (await byXPath.count() > 0 && await byXPath.isVisible()) return byXPath;

  // Fallback: pagination link with text "Next" that is not disabled
  const byText = page.locator('a').filter({ hasText: /^Next$/ }).first();
  if (await byText.count() > 0 && await byText.isVisible()) return byText;

  return null;
}

async function downloadPage(page, companyDir, pageNum, saved) {
  const docLinks = page.locator('td.appTblCell2 a.appDocumentLink');
  const count    = await docLinks.count();
  console.log(`[SEDAR] Page ${pageNum} — ${count} document(s)`);

  for (let i = 0; i < count; i++) {
    const link     = docLinks.nth(i);
    const text     = (await link.textContent()).trim();
    const href     = await link.getAttribute('href');
    let   fallback = safeFilename(text);
    if (!fallback.toLowerCase().endsWith('.pdf')) fallback += '.pdf';

    try {
      await humanDelay(500, 1200);
      const filename = await downloadByFetch(page, href, companyDir, fallback);
      console.log(`  ✓ [p${pageNum}] ${filename}`);
      saved.push(filename);
    } catch (err) {
      console.error(`  ✗ Failed (${fallback}): ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeSedarOnPage(page, context, companyName) {
  const downloadBase = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
  const companyDir   = path.join(downloadBase, companyName.replace(/[^\w\s-]/g, '_').trim());
  fs.mkdirSync(companyDir, { recursive: true });

  console.log('[SEDAR] Navigating to Documents search…');
  await navigateToDocumentsSearch(page, context);

  console.log(`[SEDAR] Searching for "${companyName}"…`);
  await searchCompany(page, companyName);

  await saveCookies(context);

  const firstCount = await page.locator('td.appTblCell2 a.appDocumentLink').count();
  if (firstCount === 0) {
    console.log('[SEDAR] No documents found. Saving page snapshot.');
    fs.writeFileSync(path.join(companyDir, 'page_snapshot.html'), await page.content());
    return [];
  }

  console.log(`[SEDAR] Downloading to: ${companyDir} (max ${MAX_PAGES} pages)`);
  const saved = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    await downloadPage(page, companyDir, pageNum, saved);

    const nextBtn = await getNextButton(page);
    if (!nextBtn) {
      console.log('[SEDAR] No more pages.');
      break;
    }

    console.log(`[SEDAR] Going to page ${pageNum + 1}…`);
    await humanDelay(800, 1500);
    await humanClick(page, nextBtn);
    await page.waitForSelector('table.appTable', { state: 'visible', timeout: 30000 });
    await humanDelay(800, 1400);
  }

  console.log(`[SEDAR] Done — ${saved.length} file(s) downloaded`);
  return saved;
}

async function scrapeSedar(companyName, options = {}) {
  const taskSlug = options.taskSlug || 'sedar_filings';

  return withBrowserSession(
    taskSlug,
    { relaySlot: options.relaySlot || 1, contextOptions: buildContextOptions() },
    async ({ page, context }) => {
    if (process.env.OREWIRE_RELAY !== 'in-process') {
      await context.addInitScript(STEALTH_INIT);
      await loadCookies(context);
    } else {
      await loadCookies(context);
    }

    try {
      return await scrapeSedarOnPage(page, context, companyName);
    } finally {
      await saveCookies(context);
    }
    }
  );
}

module.exports = { scrapeSedar, scrapeSedarOnPage };
