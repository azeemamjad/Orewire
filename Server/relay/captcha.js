/** Heuristics for bot/captcha walls — marks worker needs_human when matched. */

class CaptchaRequiredError extends Error {
  constructor(message, workerId) {
    super(message);
    this.name = 'CaptchaRequiredError';
    this.workerId = workerId;
  }
}

function isCaptchaLikeError(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('captcha') ||
    msg.includes('challenge') ||
    msg.includes('access denied') ||
    msg.includes('blocked') ||
    msg.includes('cf-browser-verification') ||
    msg.includes('just a moment')
  );
}

async function detectCaptchaOnPage(page) {
  if (!page) return false;
  try {
    const url = page.url().toLowerCase();
    if (url.includes('captcha') || url.includes('challenge')) return true;
    const title = ((await page.title()) || '').toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required')) return true;
    const hasCf = await page.locator('#challenge-form, .cf-turnstile, iframe[src*="captcha"]').count();
    return hasCf > 0;
  } catch {
    return false;
  }
}

module.exports = { CaptchaRequiredError, isCaptchaLikeError, detectCaptchaOnPage };
