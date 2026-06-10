/** Heuristics for bot/captcha walls — marks worker needs_human when matched. */

class CaptchaRequiredError extends Error {
  constructor(message, workerId) {
    super(message);
    this.name = 'CaptchaRequiredError';
    this.workerId = workerId;
  }
}

// Substrings that, in a URL/title/error, signal a bot wall. Includes the
// PerfDrive / ShieldSquare ("Imperva") wall SEDAR+ uses, which redirects to
// validate.perfdrive.com — none of the generic Cloudflare checks catch it.
const WALL_TOKENS = [
  'captcha',
  'challenge',
  'access denied',
  'blocked',
  'cf-browser-verification',
  'just a moment',
  'attention required',
  'perfdrive',          // validate.perfdrive.com redirect
  'shieldsquare',       // ShieldSquare/Imperva script + support email
  'unusual traffic',
  'verify you are human',
  'are you a robot',
];

function isCaptchaLikeError(err) {
  const msg = (err?.message || '').toLowerCase();
  return WALL_TOKENS.some((t) => msg.includes(t));
}

async function detectCaptchaOnPage(page) {
  if (!page) return false;
  try {
    const url = (page.url() || '').toLowerCase();
    if (url.includes('captcha') || url.includes('challenge') || url.includes('perfdrive')) return true;

    const title = ((await page.title()) || '').toLowerCase();
    if (WALL_TOKENS.some((t) => title.includes(t))) return true;

    // Cloudflare / generic captcha widgets.
    const hasWidget = await page
      .locator('#challenge-form, .cf-turnstile, iframe[src*="captcha"], iframe[src*="perfdrive"], iframe[title*="captcha" i]')
      .count();
    if (hasWidget > 0) return true;

    // PerfDrive/ShieldSquare injects its script + a support@shieldsquare.com
    // contact into the page body. Sniff the HTML for those markers.
    const wallInBody = await page.evaluate(() => {
      const html = (document.documentElement && document.documentElement.outerHTML) || '';
      const lc = html.toLowerCase();
      return (
        lc.includes('perfdrive') ||
        lc.includes('shieldsquare') ||
        lc.includes('_pxhd') ||                 // PerimeterX/PerfDrive cookie marker
        /verify (you are|that you are) (a )?human/i.test(html) ||
        /unusual traffic from your/i.test(html)
      );
    }).catch(() => false);
    return !!wallInBody;
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

module.exports = { CaptchaRequiredError, isCaptchaLikeError, detectCaptchaOnPage, waitForCaptchaCleared };
