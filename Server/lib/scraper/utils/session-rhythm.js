/**
 * Make a long run look like a person, not a queue.
 *
 * A session that opens the Documents search, runs a query, downloads, clears the
 * form and immediately queries again — 1571 times, at a constant rate, never
 * looking at anything else — is a recognisable shape regardless of how good the
 * browser fingerprint is. Radware scores request rhythm and navigation variety,
 * not just the TLS handshake.
 *
 * So every few companies the worker takes a break: it stops searching, reads
 * something else on the site for a while, and comes back. The pages it visits
 * are deliberately chosen from what the landing page actually links to, and
 * deliberately exclude anything with side effects — no Filer Login, no Register
 * to File, no "Subscribe to alerts" (those submit forms and send email), and no
 * Français, which switches the locale and would break the scraper's selectors.
 */
const { humanDelay, humanScroll, randomInt } = require('./human');

// Read-only pages a person researching filings would plausibly open.
const BROWSE_TARGETS = [
  { name: 'landing page', url: 'https://www.sedarplus.ca/home/' },
  // These URLs are copied verbatim from the landing page's own links. Do not
  // reconstruct them from memory: SEDAR+ answers an unknown `service=` name with
  // HTTP 200 and a blank shell, so a typo does not fail loudly — it just makes
  // the browser repeatedly request a page that does not exist, which is a worse
  // signal than not browsing at all.
  {
    name: 'Reporting Issuers List',
    url: 'https://www.sedarplus.ca/csa-party/service/create.html'
       + '?targetAppCode=csa-party&service=searchReportingIssuers&_locale=en',
  },
  {
    name: 'Cease Trade Orders',
    url: 'https://www.sedarplus.ca/csa-order/service/create.html'
       + '?targetAppCode=csa-order&service=searchCeaseTradeOrders&_locale=en',
  },
  {
    name: 'Disciplined List',
    url: 'https://www.sedarplus.ca/csa-order/service/create.html'
       + '?targetAppCode=csa-order&service=searchDisciplinedList&_locale=en',
  },
  {
    name: 'SEDAR+ Rules and Forms',
    url: 'https://www.sedarplus.ca/onlinehelp/general-help/sedar-rule-and-forms/',
  },
];

/** @type {Map<string, { since: number, threshold: number }>} */
const _state = new Map();

function enabled() {
  return process.env.SEDAR_BREAKS !== 'false';
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** How many companies until the next break — re-rolled each time, never fixed. */
function pickThreshold() {
  const min = Math.max(1, envInt('SEDAR_BREAK_EVERY_MIN', 3));
  const max = Math.max(min, envInt('SEDAR_BREAK_EVERY_MAX', 6));
  return randomInt(min, max);
}

async function browseSomethingElse(page, guardCaptcha) {
  const min = Math.max(1, envInt('SEDAR_BREAK_PAGES_MIN', 1));
  const max = Math.max(min, envInt('SEDAR_BREAK_PAGES_MAX', 2));
  const count = randomInt(min, max);

  const pool = [...BROWSE_TARGETS];
  for (let i = 0; i < count && pool.length; i++) {
    const target = pool.splice(randomInt(0, pool.length - 1), 1)[0];
    try {
      console.log(`[SEDAR] break — reading "${target.name}"`);
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // A break must not paper over a wall: if we have been challenged, surface
      // it here rather than discovering it on the next company's search.
      if (guardCaptcha) await guardCaptcha();
      // Dwell time on the page being "read". Configurable so the whole rhythm
      // can be slowed down for a target that is scoring you harder, or sped up
      // in tests.
      const dwellMin = Math.max(0, envInt('SEDAR_BROWSE_DWELL_MIN_MS', 2000));
      const dwellMax = Math.max(dwellMin, envInt('SEDAR_BROWSE_DWELL_MAX_MS', 7000));
      await humanDelay(Math.floor(dwellMin * 0.4), Math.floor(dwellMax * 0.4));
      await humanScroll(page);
      await humanDelay(Math.floor(dwellMin * 0.6), Math.floor(dwellMax * 0.6));
    } catch (err) {
      // Idle browsing is decoration — never fail a run because a side page was
      // slow or moved.
      console.warn(`[SEDAR] break — could not open "${target.name}": ${err.message.split('\n')[0]}`);
    }
  }
}

/**
 * Call before each company. Counts companies on this session and, when the
 * (re-rolled) threshold is reached, pauses and browses elsewhere.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {string} [opts.sessionKey] stable per-worker id — the relay reuses one
 *   page per worker, so state has to live across scrape calls
 * @param {function} [opts.guardCaptcha]
 * @returns {Promise<boolean>} whether a break was taken
 */
async function maybeTakeBreak(page, opts = {}) {
  if (!enabled()) return false;
  const key = opts.sessionKey || 'local';

  let st = _state.get(key);
  if (!st) {
    st = { since: 0, threshold: pickThreshold() };
    _state.set(key, st);
  }

  st.since += 1;
  if (st.since < st.threshold) return false;

  const minMs = Math.max(0, envInt('SEDAR_BREAK_MIN_MS', 45000));
  const maxMs = Math.max(minMs, envInt('SEDAR_BREAK_MAX_MS', 180000));
  const total = randomInt(minMs, maxMs);

  console.log(
    `[SEDAR] Taking a break after ${st.since} companies — ~${Math.round(total / 1000)}s `
    + 'of reading other pages',
  );

  st.since = 0;
  st.threshold = pickThreshold();   // re-roll, so the cadence is never periodic

  // Split the pause either side of the browsing rather than idling in one block:
  // a session that goes silent for exactly N seconds then resumes is its own tell.
  const before = randomInt(Math.floor(total * 0.2), Math.floor(total * 0.5));
  await humanDelay(before, before);
  await browseSomethingElse(page, opts.guardCaptcha);
  const after = Math.max(0, total - before);
  await humanDelay(Math.floor(after * 0.6), after);

  console.log(`[SEDAR] Break over — next in ${st.threshold} companies`);
  return true;
}

/** Forget a session's counter (worker respawned, run finished). */
function resetSession(sessionKey) {
  _state.delete(sessionKey || 'local');
}

module.exports = { maybeTakeBreak, resetSession, BROWSE_TARGETS };
