require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { humanDelay, humanClick, humanType, randomViewport, STEALTH_INIT } = require('../utils/human');
const { withBrowserSession } = require('../utils/browser-session');
const { DOWNLOADS_DIR, COOKIE_FILE } = require('../paths');

const BASE_URL = 'https://www.sedarplus.ca/home/';
const DEFAULT_DAYS_BACK = 30;
// Browser / context setup
// ---------------------------------------------------------------------------

function buildContextOptions() {
  const viewport = randomViewport();
  const options = {
    acceptDownloads: true,
    viewport,
    locale:     process.env.LOCALE     || 'en-US',
    timezoneId: process.env.TIMEZONE   || 'America/Toronto',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  };
  // Do NOT pin a UA string by default. Overriding it leaves navigator.userAgent
  // claiming one Chrome version while sec-ch-ua still reports the browser's real
  // one, and that mismatch is precisely what SEDAR+'s wall fingerprints — the
  // block page echoes the pinned UA back in its `sst=` parameter. Letting the
  // browser speak for itself keeps the two consistent.
  if (process.env.USER_AGENT) options.userAgent = process.env.USER_AGENT;
  return options;
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

async function goToDocumentsPage(page, guardCaptcha) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
  if (guardCaptcha) await guardCaptcha();
  await humanDelay(800, 1500);

  const navTrigger = page.getByRole('link', { name: /search sedar/i }).first();
  await navTrigger.waitFor({ state: 'visible', timeout: 15000 });
  await humanClick(page, navTrigger);
  if (guardCaptcha) await guardCaptcha();

  await humanDelay(600, 1000);
  const docsLink = page.getByRole('link', { name: /^documents$/i }).first();
  await docsLink.waitFor({ state: 'visible', timeout: 10000 });
  await humanClick(page, docsLink);
  if (guardCaptcha) await guardCaptcha();
}

async function navigateToDocumentsSearch(page, context, guardCaptcha) {
  await goToDocumentsPage(page, guardCaptcha);

  try {
    await page.waitForSelector('input[placeholder="Profile name or number"]', { state: 'visible', timeout: 30000 });
  } catch {
    if (guardCaptcha) await guardCaptcha();
    // Session cookies expired — SEDAR+ redirected back to /home/.
    // Clear stale cookies and retry once with a fresh session.
    if (page.url().includes('/home/')) {
      console.log('[SEDAR] Session expired — clearing cookies and retrying…');
      await context.clearCookies();
      if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE);
      await goToDocumentsPage(page, guardCaptcha);
      await page.waitForSelector('input[placeholder="Profile name or number"]', { state: 'visible', timeout: 30000 });
    } else {
      throw new Error(`Documents search page did not load (URL: ${page.url()})`);
    }
  }

  if (guardCaptcha) await guardCaptcha();
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

// Compare our company name against a SEDAR+ suggestion without tripping over
// punctuation, accents, or the bilingual "English name / nom français" format
// SEDAR+ uses ("Agnico Eagle Mines Limited / Mines Agnico Eagle Limitée").
// Also drops the two annotations that otherwise defeat a substring compare:
// SEDAR's trailing profile number "(000000834)", and the "(formerly was \u2026)"
// history our own company names carry.
function normalizeProfileName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\s*(?:\d{4,}|formerly[^)]*)\)/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Guards against a degenerately short name ("BMO") matching by accident.
const MIN_NAME_OVERLAP = 5;

function profileNamesMatch(needle, text) {
  if (!needle || !text) return false;
  if (needle.length >= MIN_NAME_OVERLAP && text.includes(needle)) return true;
  if (text.length >= MIN_NAME_OVERLAP && needle.includes(text)) return true;
  return false;
}

async function searchCompany(page, companyName, daysBack = DEFAULT_DAYS_BACK, guardCaptcha) {
  if (guardCaptcha) await guardCaptcha();
  await humanType(page, page.locator('input[placeholder="Profile name or number"]'), companyName);

  try {
    await page.waitForSelector('ul.ui-autocomplete li.ui-menu-item', { state: 'visible', timeout: 15000 });
  } catch {
    if (guardCaptcha) await guardCaptcha();
    await page.waitForSelector('ul.ui-autocomplete li.ui-menu-item', { state: 'visible', timeout: 15000 });
  }
  await humanDelay(400, 800);

  const allItems = page.locator('ul.ui-autocomplete li.ui-menu-item');
  const itemCount = await allItems.count();

  // Pick the first suggestion that actually names the company we asked for.
  // There is deliberately NO index-0 fallback: SEDAR+ answers a non-matching
  // query with other issuers' profiles, so defaulting to the first row files
  // someone else's documents under this company's name.
  const needle = normalizeProfileName(companyName);
  let bestIdx = -1;
  const seen = [];
  for (let i = 0; i < itemCount; i++) {
    const raw = (await allItems.nth(i).textContent()).trim();
    seen.push(raw);
    if (profileNamesMatch(needle, normalizeProfileName(raw))) { bestIdx = i; break; }
  }
  if (bestIdx === -1) {
    throw new Error(
      `No SEDAR+ profile matches "${companyName}" — got [${seen.slice(0, 5).map((s) => `"${s}"`).join(', ')}]. `
      + 'Refusing to download another issuer\'s filings.',
    );
  }
  const chosen = (await allItems.nth(bestIdx).textContent()).trim();
  console.log(`[SEDAR] Selecting: "${chosen}"`);

  // Click autocomplete item — fires serviceLookupSelected AJAX which sets the company
  // filter server-side but does NOT run the search yet.  Wait for that response.
  // If it never arrives the profile filter was never applied, and searching anyway
  // returns EVERY issuer's documents for the date range. Fail instead: a missed
  // company is recoverable on the next run, a corpus of misattributed filings is not.
  const [filterApplied] = await Promise.all([
    page.waitForResponse(r => r.url().includes('update.html'), { timeout: 15000 })
      .then(() => true)
      .catch(() => false),
    allItems.nth(bestIdx).click(),
  ]);
  if (!filterApplied) {
    throw new Error(
      `SEDAR+ never applied the profile filter for "${chosen}" (no update.html after selection) — `
      + 'refusing to run an unfiltered search.',
    );
  }

  // Selecting a profile triggers a FULL page re-render, not a partial update:
  // the "Profile name or number" input is replaced by a read-only .appAttrValue
  // holding "<name> (<profile number>)". Waiting a flat ~1s here raced that
  // re-render, so the date fields were filled and Search was clicked on the
  // PRE-render DOM — a search with no profile filter, which returns every
  // issuer's documents for the date range. That is how unrelated filings ended
  // up under the wrong company. Wait for the re-render and confirm it stuck.
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  try {
    await page.waitForFunction(
      () => !document.querySelector('input[placeholder="Profile name or number"]')
        && Array.from(document.querySelectorAll('.appAttrValue'))
          .some((el) => /\(\d{6,}\)/.test(el.textContent || '')),
      { timeout: 30000 },
    );
  } catch {
    throw new Error(
      `SEDAR+ did not finish applying the profile "${chosen}" — refusing to run an unfiltered search.`,
    );
  }

  const heldProfile = await page.$$eval('.appAttrValue', (els) => {
    const hit = els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())
      .find((t) => /\(\d{6,}\)/.test(t));
    return hit || '';
  });
  if (!profileNamesMatch(needle, normalizeProfileName(heldProfile))) {
    throw new Error(
      `SEDAR+ applied profile "${heldProfile}" but we asked for "${companyName}" — aborting.`,
    );
  }
  console.log(`[SEDAR] Profile filter applied: "${heldProfile}"`);
  await humanDelay(600, 1000);

  // Fill date range: daysBack days ago → today (format DD/MM/YYYY)
  const today    = new Date();
  const days     = Math.max(1, parseInt(daysBack, 10) || DEFAULT_DAYS_BACK);
  const fromDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
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
  // A profile with nothing filed in the window renders no results table at all.
  // Waiting unconditionally turned that legitimate empty result into a thrown
  // error, so quiet companies were counted as pipeline failures. Tolerate it and
  // let the zero-document path below report it.
  const resultsAppeared = await page
    .waitForSelector('table.appTable', { state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!resultsAppeared) {
    console.log('[SEDAR] No results table — nothing filed for this profile in the date range.');
  }
  if (guardCaptcha) await guardCaptcha();
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

async function downloadPage(page, companyDir, pageNum, saved, companyName) {
  const docLinks = page.locator('td.appTblCell2 a.appDocumentLink');
  const count    = await docLinks.count();
  console.log(`[SEDAR] Page ${pageNum} — ${count} document(s)`);

  const needle = companyName ? normalizeProfileName(companyName) : null;
  let skipped = 0;

  for (let i = 0; i < count; i++) {
    const link     = docLinks.nth(i);
    const text     = (await link.textContent()).trim();
    const href     = await link.getAttribute('href');
    let   fallback = safeFilename(text);
    if (!fallback.toLowerCase().endsWith('.pdf')) fallback += '.pdf';

    // Every results row carries the filing issuer in its "Profile(s)" column
    // (td.appTblCell1). Check it per row so a stray result can never be written
    // into another company's folder, whatever the search state was.
    if (needle) {
      const rowProfile = await link.evaluate((el) => {
        const tr = el.closest('tr');
        const cell = tr && tr.querySelector('td.appTblCell1');
        return cell ? cell.textContent.replace(/\s+/g, ' ').trim() : '';
      });
      if (rowProfile && !profileNamesMatch(needle, normalizeProfileName(rowProfile))) {
        skipped++;
        console.warn(`  ⚠ skipping "${fallback}" — filed by "${rowProfile}", not "${companyName}"`);
        continue;
      }
    }

    try {
      await humanDelay(500, 1200);
      const filename = await downloadByFetch(page, href, companyDir, fallback);
      console.log(`  ✓ [p${pageNum}] ${filename}`);
      saved.push(filename);
    } catch (err) {
      console.error(`  ✗ Failed (${fallback}): ${err.message}`);
    }
  }

  if (skipped) {
    console.warn(`[SEDAR] Page ${pageNum} — skipped ${skipped}/${count} document(s) filed by another issuer`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeSedarOnPage(page, context, companyName, options = {}) {
  const { guardCaptcha } = options;
  const downloadBase = DOWNLOADS_DIR;
  const companyDir   = path.join(downloadBase, companyName.replace(/[^\w\s-]/g, '_').trim());
  fs.mkdirSync(companyDir, { recursive: true });

  console.log('[SEDAR] Navigating to Documents search…');
  await navigateToDocumentsSearch(page, context, guardCaptcha);

  console.log(`[SEDAR] Searching for "${companyName}"…`);
  await searchCompany(page, companyName, options.daysBack, guardCaptcha);

  await saveCookies(context);

  if (guardCaptcha) await guardCaptcha();
  const firstCount = await page.locator('td.appTblCell2 a.appDocumentLink').count();
  if (firstCount === 0) {
    console.log('[SEDAR] No documents found. Saving page snapshot.');
    fs.writeFileSync(path.join(companyDir, 'page_snapshot.html'), await page.content());
    return [];
  }

  console.log(`[SEDAR] Downloading to: ${companyDir} (max ${MAX_PAGES} pages)`);
  const saved = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    if (guardCaptcha) await guardCaptcha();
    await downloadPage(page, companyDir, pageNum, saved, companyName);

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
    async ({ page, context, guardCaptcha }) => {
    if (process.env.OREWIRE_RELAY !== 'in-process') {
      await context.addInitScript(STEALTH_INIT);
      await loadCookies(context);
    } else {
      await loadCookies(context);
    }

    try {
      return await scrapeSedarOnPage(page, context, companyName, {
        daysBack: options.daysBack,
        guardCaptcha,
      });
    } finally {
      await saveCookies(context);
    }
    }
  );
}

module.exports = { scrapeSedar, scrapeSedarOnPage };
