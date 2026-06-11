/** Heuristics for bot/captcha walls — marks worker needs_human when matched. */

class CaptchaRequiredError extends Error {
  constructor(message, workerId) {
    super(message);
    this.name = 'CaptchaRequiredError';
    this.workerId = workerId;
  }
}

// IMPORTANT: SEDAR+ embeds its ShieldSquare/PerfDrive protection script on EVERY
// page, so the strings "perfdrive"/"shieldsquare"/"_pxhd" live in normal pages
// too. Detecting on those = false positives. We only treat it as a wall on an
// ACTIVE block: a redirect to the block host, a real challenge widget, or the
// visible (rendered) block text — never inline scripts.

// Host fragments that only appear once you've actually been redirected to a
// block/challenge page.
const BLOCK_URL_FRAGMENTS = [
  'validate.perfdrive.com',   // ShieldSquare/PerfDrive interstitial
  'captcha-delivery.com',     // DataDome
  '/cdn-cgi/challenge',       // Cloudflare managed challenge
  '/_incapsula_',             // Imperva Incapsula
];

// Phrases that only appear in the VISIBLE text of an interstitial, not in the
// always-present protection script.
const BLOCK_TEXT_RE = /(access to this page has been denied|verify (you are|that you are) (a )?human|unusual traffic from your|request unsuccessful\.?\s*incapsula|why (have i|was i) been blocked|complete the security check|please enable (js|javascript) and cookies)/i;

function isCaptchaLikeError(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('captcha') ||
    msg.includes('validate.perfdrive') ||
    msg.includes('access denied') ||
    msg.includes('just a moment')
  );
}

async function detectCaptchaOnPage(page) {
  if (!page) return false;
  try {
    const url = (page.url() || '').toLowerCase();
    if (BLOCK_URL_FRAGMENTS.some((f) => url.includes(f))) return true;

    const title = ((await page.title()) || '').toLowerCase();
    if (
      title.includes('just a moment') ||
      title.includes('attention required') ||
      title.includes('access denied') ||
      title.includes('are you a robot')
    ) {
      return true;
    }

    // A real, present challenge widget (Cloudflare / hCaptcha / reCAPTCHA /
    // PerimeterX / PerfDrive). The embedded protection script does NOT add these.
    const widget = await page
      .locator(
        '#challenge-form, .cf-turnstile, iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="captcha-delivery"], iframe[title*="captcha" i], #px-captcha, .px-captcha',
      )
      .count()
      .catch(() => 0);
    if (widget > 0) return true;

    // Visible block text only — read innerText, never outerHTML/scripts.
    const blocked = await page
      .evaluate((reSrc) => {
        const t = (document.body && document.body.innerText) || '';
        return new RegExp(reSrc, 'i').test(t);
      }, BLOCK_TEXT_RE.source)
      .catch(() => false);
    return !!blocked;
  } catch {
    return false;
  }
}

/**
 * Poll until the captcha/bot wall is no longer present (i.e. a human solved it
 * on the worker's browser), or the timeout elapses.
 * @returns {Promise<boolean>} true if cleared, false if it timed out.
 */
async function waitForCaptchaCleared(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? parseInt(process.env.CAPTCHA_WAIT_MS || '600000', 10); // 10 min
  const pollMs = opts.pollMs ?? parseInt(process.env.CAPTCHA_POLL_MS || '3000', 10);
  const deadline = Date.now() + timeoutMs;
  // Require two consecutive clean polls so we don't resume mid-redirect.
  let cleanStreak = 0;
  while (Date.now() < deadline) {
    if (opts.shouldStop?.()) return 'stopped';
    const stillBlocked = await detectCaptchaOnPage(page);
    if (!stillBlocked) {
      cleanStreak += 1;
      if (cleanStreak >= 2) return true;
    } else {
      cleanStreak = 0;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

/**
 * Pause until a human marks the worker active again (Relay admin) or the bot
 * wall clears on its own. Yields the Playwright queue while waiting so Relay
 * View can inject mouse/keyboard.
 * @returns {Promise<true|false|'stopped'>}
 */
async function waitForHumanResume(workerId, opts = {}) {
  const { pool } = require('./pool');
  const { STATUS } = require('./constants');
  const timeoutMs = opts.timeoutMs ?? parseInt(process.env.CAPTCHA_WAIT_MS || '600000', 10);
  const pollMs = opts.pollMs ?? parseInt(process.env.CAPTCHA_POLL_MS || '2000', 10);
  const deadline = Date.now() + timeoutMs;
  const page = opts.page || null;
  let cleanStreak = 0;

  const w = pool.getWorker(workerId);
  if (!w) return false;
  if (w.status === STATUS.ACTIVE) return true;

  const waitForAdminResume = new Promise((resolve) => {
    w._humanResume = (outcome) => {
      w._humanResume = null;
      resolve(outcome === 'stopped' ? 'stopped' : true);
    };
  });

  const pollLoop = (async () => {
    while (Date.now() < deadline) {
      if (opts.shouldStop?.()) return 'stopped';
      const worker = pool.getWorker(workerId);
      if (!worker) return false;
      if (worker.status === STATUS.ACTIVE) return true;
      if (page) {
        const blocked = await detectCaptchaOnPage(page);
        if (!blocked) {
          cleanStreak += 1;
          if (cleanStreak >= 2) {
            pool.setStatus(workerId, STATUS.ACTIVE);
            return true;
          }
        } else {
          cleanStreak = 0;
        }
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return false;
  })();

  try {
    const result = await Promise.race([waitForAdminResume, pollLoop]);
    if (result === 'stopped') return 'stopped';
    if (result === true) return true;
    return false;
  } finally {
    if (typeof w._humanResume === 'function') w._humanResume = null;
  }
}

module.exports = {
  CaptchaRequiredError,
  isCaptchaLikeError,
  detectCaptchaOnPage,
  waitForCaptchaCleared,
  waitForHumanResume,
};
