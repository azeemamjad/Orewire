require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { humanDelay, humanClick, humanType, randomViewport, STEALTH_INIT } = require('../../utils/human');

const BASE_URL    = 'https://www.sedarplus.ca/home/';
// Direct Profiles search — more reliable than opening the landing-page submenu.
const PROFILE_SEARCH_URL =
  'https://www.sedarplus.ca/csa-party/service/create.html?targetAppCode=csa-party&service=searchIndustryParticipant&_locale=en';
const COOKIE_FILE = path.resolve(process.env.COOKIE_FILE || './data/cookies.json');

function buildContextOptions() {
  return {
    viewport: randomViewport(),
    userAgent: process.env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale:     process.env.LOCALE   || 'en-US',
    timezoneId: process.env.TIMEZONE || 'America/Toronto',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  };
}

async function loadCookies(context) {
  if (fs.existsSync(COOKIE_FILE)) {
    try { await context.addCookies(JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))); } catch { /* ignore */ }
  }
}
async function saveCookies(context) {
  try {
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Navigation — open the SEDAR+ issuer-profile search.
// NOTE: SEDAR+ is bot-protected and its markup shifts; the link/field names
// below are best-effort and may need tuning against the live site.
// ---------------------------------------------------------------------------

// Search SEDAR+ → "Profiles" (NOT Documents / Issuers). The Profiles search has
// the "Profile name or number" input; selecting a result opens the company's
// profile page, which contains the transfer agent.
async function goToProfileSearch(page) {
  await page.goto(PROFILE_SEARCH_URL, { waitUntil: 'load', timeout: 60000 });
  await humanDelay(800, 1500);

  // Profiles search input is id="QueryString" (documents search uses a different form).
  await page.waitForSelector('#QueryString', { state: 'visible', timeout: 30000 });
  await humanDelay(400, 700);
}

// ---------------------------------------------------------------------------
// Search a company and open its profile.
// ---------------------------------------------------------------------------

async function searchAndOpenProfile(page, companyName) {
  const debug = !!process.env.TA_DEBUG;

  // Type the company name into the Profiles search input (#QueryString).
  const input = page.locator('#QueryString');
  await input.fill('');
  await humanType(page, input, companyName);
  await humanDelay(400, 700);

  // Click Search (ADF replaces content inside [id^="AsyncWrapperW"] — node id varies per session).
  await page.evaluate(() => {
    const btn = document.querySelector('button.appSearchButton.appSubmitButton')
      || Array.from(document.querySelectorAll('button, a')).find(b => (b.textContent || '').trim().toLowerCase() === 'search');
    if (btn) btn.click();
  });

  // Company name in results is an <a> whose class *contains* viewIndustryParticipant (one long token).
  const profileResultLink = 'a[class*="viewIndustryParticipant"]';
  await page
    .waitForSelector(profileResultLink, { state: 'visible', timeout: 30000 })
    .catch(() => {});
  await humanDelay(800, 1400);
  if (debug) await dumpSnapshot(page, companyName, 'results');

  if ((await page.locator(profileResultLink).count()) === 0) return false;

  // SEDAR+ uses Trinidad JS handlers — coordinate clicks often don't fire; .click() does (see scraper.js).
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('update.html'), { timeout: 30000 }).catch(() => {}),
    page.evaluate((sel) => {
      const link = document.querySelector(sel);
      if (link) link.click();
    }, profileResultLink),
  ]);
  await humanDelay(600, 1000);

  // Profile detail replaces the search view — wait for issuer fields, not the results table.
  await page
    .waitForFunction(() => {
      const t = (document.body && document.body.innerText) || '';
      if (/transfer\s+agent/i.test(t)) return true;
      if (/full\s+legal\s+name/i.test(t) && !/search for profiles/i.test(t)) return true;
      if (/associated\s+entit/i.test(t)) return true;
      return false;
    }, { timeout: 30000 })
    .catch(() => {});
  await humanDelay(900, 1500);
  if (debug) await dumpSnapshot(page, companyName, 'profile');
  return true;
}

// ---------------------------------------------------------------------------
// Extract the transfer agent / registrar from whatever profile page we land on.
// Text-based so it survives minor DOM changes: find a label cell, take its value.
// ---------------------------------------------------------------------------

async function extractTransferAgent(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const looksLikeAddress = (v) => /\d+\s+\w+.*(?:street|st\.|avenue|ave\.|road|rd\.|suite|floor|blvd|boulevard)/i.test(v);

    const taLabel = /transfer agent\s*(?:or|and|&|\/)?\s*registrar/i;

    // SEDAR+ issuer profile: label and value live in the same .appAttribute row.
    for (const row of document.querySelectorAll('.appAttribute, .appAttrText')) {
      const labelEl = row.querySelector('.appLabelText, .appAttrLabel');
      const valueEl = row.querySelector('.appAttrValue');
      if (!labelEl || !valueEl) continue;
      const lbl = norm(labelEl.textContent);
      if (!taLabel.test(lbl)) continue;
      const v = norm(valueEl.textContent);
      if (v && v.length > 1 && v.length < 200 && !looksLikeAddress(v)) return v;
    }

    // Fallback within the transfer-agent associated-entities block.
    const box = document.querySelector('[class*="transferAgentBox"]');
    if (box) {
      for (const valueEl of box.querySelectorAll('.appAttrValue')) {
        const v = norm(valueEl.textContent);
        if (v && v.length > 1 && v.length < 200 && !looksLikeAddress(v)) return v;
      }
    }

    return null;
  });
}

// Save the rendered page (HTML + visible text) so we can inspect SEDAR+'s real
// structure and locate the transfer agent. Enabled with TA_DEBUG=1.
async function dumpSnapshot(page, companyName, label) {
  try {
    const dir = path.resolve(process.env.TA_DEBUG_DIR || './downloads/_ta_debug');
    fs.mkdirSync(dir, { recursive: true });
    const safe = companyName.replace(/[^\w\s-]/g, '_').trim().slice(0, 60);
    const base = path.join(dir, `${safe}__${label}`);
    fs.writeFileSync(`${base}.url.txt`, page.url());
    fs.writeFileSync(`${base}.html`, await page.content());
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    fs.writeFileSync(`${base}.txt`, text);
    console.error(`[SEDAR-TA] snapshot → ${base}.{html,txt}  (url: ${page.url()})`);
  } catch (e) {
    console.error(`[SEDAR-TA] snapshot failed: ${e.message}`);
  }
}

/**
 * Scrape one company's transfer agent. Expects an already-open `page`
 * (caller manages the browser/session so a batch reuses one login).
 * Returns the transfer-agent string, or null when not found.
 */
async function scrapeTransferAgentForCompany(page, companyName) {
  const debug = !!process.env.TA_DEBUG;
  try {
    await goToProfileSearch(page);
    const opened = await searchAndOpenProfile(page, companyName);
    if (!opened) {
      if (debug) await dumpSnapshot(page, companyName, 'no-profile');
      return null;
    }
    return extractTransferAgent(page);
  } catch (err) {
    // Capture whatever page we ended up on so we can see SEDAR+'s real markup.
    if (debug) await dumpSnapshot(page, companyName, 'error');
    throw err;
  }
}

module.exports = {
  buildContextOptions,
  loadCookies,
  saveCookies,
  STEALTH_INIT,
  scrapeTransferAgentForCompany,
};
