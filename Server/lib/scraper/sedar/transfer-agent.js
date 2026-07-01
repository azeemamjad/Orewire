require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { humanDelay, humanClick, humanType, humanReadPause, humanScroll, randomViewport, STEALTH_INIT } = require('../utils/human');
const { COOKIE_FILE } = require('../paths');

// ---------------------------------------------------------------------------
// Result matching — SEDAR+ returns several profiles for a query and the right
// one isn't always row 1. Score each result's name against the company name and
// pick the best, so we don't grab a neighbour's transfer agent.
// ---------------------------------------------------------------------------

// Legal-entity suffixes / filler that shouldn't drive a match. We deliberately
// keep distinctive words (commodity/place names) so similar miners stay distinct.
const NAME_NOISE = /\b(the|ltd|limited|inc|incorporated|corp|corporation|co|company|plc|llc|lp|nl|sa|ag|holdings?|group)\b/gi;

function normName(s) {
  return (s || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coreName(s) {
  return normName(s).replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

// 0–100 similarity between a result label and the target company name.
function matchScore(candidate, target) {
  const c = normName(candidate);
  const t = normName(target);
  if (!c || !t) return 0;
  if (c === t) return 100;
  const cc = coreName(candidate);
  const tc = coreName(target);
  if (cc && cc === tc) return 95;
  if (cc && tc && (cc.startsWith(tc) || tc.startsWith(cc))) return 80;
  const cToks = new Set(cc.split(' ').filter(Boolean));
  const tToks = tc.split(' ').filter(Boolean);
  if (!tToks.length) return 0;
  const overlap = tToks.filter((tok) => cToks.has(tok)).length;
  return Math.round((overlap / tToks.length) * 70);
}

// Index of the best-matching result; -1 if results array is empty.
function pickBestResultIndex(labels, companyName) {
  if (!labels.length) return -1;
  let bestIdx = 0;
  let bestScore = -1;
  labels.forEach((label, i) => {
    const score = matchScore(label, companyName);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}

const BASE_URL    = 'https://www.sedarplus.ca/home/';
// Direct Profiles search — more reliable than opening the landing-page submenu.
const PROFILE_SEARCH_URL =
  'https://www.sedarplus.ca/csa-party/service/create.html?targetAppCode=csa-party&service=searchIndustryParticipant&_locale=en';

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
  // SEDAR+ intermittently serves a 4xx/5xx (rate-limit / bot-block) to the
  // relay IP. A hard goto failure on company 1 aborts the whole batch, so retry
  // a few times with backoff — a transient block self-heals, a sustained one
  // still surfaces (with the real status code) after the attempts are spent.
  const attempts = parseInt(process.env.TA_GOTO_RETRIES || '3', 10);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await page.goto(PROFILE_SEARCH_URL, { waitUntil: 'load', timeout: 60000 });
      const status = resp ? resp.status() : 0;
      if (status >= 400) {
        const e = new Error(`SEDAR+ returned HTTP ${status} for the profile search (likely a rate-limit / bot-block)`);
        e.name = 'NavigationBlockedError';
        throw e;
      }
      await humanDelay(800, 1500);
      // Profiles search input is id="QueryString" (documents search uses a different form).
      await page.waitForSelector('#QueryString', { state: 'visible', timeout: 30000 });
      await humanDelay(400, 700);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const backoff = 5000 * attempt;
        if (process.env.TA_DEBUG) {
          console.error(`[SEDAR-TA] goto attempt ${attempt}/${attempts} failed (${err.message}); retrying in ${backoff}ms`);
        }
        await humanDelay(backoff, backoff + 3000);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Search a company and open its profile.
// ---------------------------------------------------------------------------

async function searchAndOpenProfile(page, companyName, guardCaptcha) {
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
  // A bot wall may have replaced the results — check before reading them.
  if (guardCaptcha) await guardCaptcha();
  // Browse the results like a person before clicking through.
  await humanScroll(page);
  await humanReadPause();
  if (debug) await dumpSnapshot(page, companyName, 'results');

  // Read every result label, then pick the row that best matches the company
  // name (not blindly the first — the right profile is often row 2+).
  const labels = await page.$$eval(profileResultLink, (els) =>
    els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()),
  );
  if (labels.length === 0) return false;
  const bestIdx = pickBestResultIndex(labels, companyName);
  if (debug) {
    console.error(`[SEDAR-TA] "${companyName}" → ${labels.length} result(s); picked #${bestIdx + 1}: "${labels[bestIdx]}" (score ${matchScore(labels[bestIdx], companyName)})`);
  }

  // SEDAR+ uses Trinidad JS handlers — coordinate clicks often don't fire; .click() does (see scraper.js).
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('update.html'), { timeout: 30000 }).catch(() => {}),
    page.evaluate(({ sel, idx }) => {
      const link = document.querySelectorAll(sel)[idx];
      if (link) link.click();
    }, { sel: profileResultLink, idx: bestIdx }),
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
  // The profile load is another point a wall can appear.
  if (guardCaptcha) await guardCaptcha();
  await humanScroll(page);
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
async function scrapeTransferAgentForCompany(page, companyName, options = {}) {
  const debug = !!process.env.TA_DEBUG;
  const guardCaptcha = options.guardCaptcha;
  try {
    await goToProfileSearch(page);
    // The bot wall typically appears right after the first navigation.
    if (guardCaptcha) await guardCaptcha();
    const opened = await searchAndOpenProfile(page, companyName, guardCaptcha);
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
