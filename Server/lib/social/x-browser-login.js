/**
 * Browser (Playwright) login fallback when HTTP onboarding ATT flow fails.
 * Extracts auth_token + ct0 cookies from a real Chromium session.
 */
async function loginWithBrowser({ username, password, email = '', proxy = null } = {}) {
  const user = String(username || '').replace(/^@/, '').trim();
  if (!user || !password) throw new Error('Username and password are required');

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright is not available for browser login');
  }

  const launchOpts = {
    headless: process.env.SOCIAL_X_HEADLESS !== 'false',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  };
  if (proxy && typeof proxy === 'object' && proxy.server) {
    launchOpts.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    };
  } else if (typeof proxy === 'string' && proxy.trim()) {
    try {
      const u = new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
      launchOpts.proxy = {
        server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    } catch {
      launchOpts.proxy = { server: proxy };
    }
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/just a moment|attention required|cloudflare|verify you are human/i.test(bodyText)) {
      throw new Error('Cloudflare challenge page — browser login blocked from this IP');
    }

    // Username / email / phone
    const userInput = page.locator('input[autocomplete="username"], input[name="text"]').first();
    await userInput.waitFor({ state: 'visible', timeout: 30000 });
    await userInput.fill(user);
    await page.getByRole('button', { name: /next/i }).first().click({ timeout: 10000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await page.waitForTimeout(1200);

    // Unusual activity / email-or-phone challenge
    const unusual = page.locator('input[data-testid="ocfEnterTextTextInput"], input[name="text"]');
    if (await unusual.first().isVisible({ timeout: 2500 }).catch(() => false)) {
      const value = email || user;
      await unusual.first().fill(value);
      await page.getByRole('button', { name: /next/i }).first().click({ timeout: 8000 }).catch(async () => {
        await page.keyboard.press('Enter');
      });
      await page.waitForTimeout(1000);
    }

    // Password
    const passInput = page.locator('input[name="password"], input[type="password"]').first();
    await passInput.waitFor({ state: 'visible', timeout: 30000 });
    await passInput.fill(password);
    await page.getByRole('button', { name: /log in/i }).first().click({ timeout: 10000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });

    await page.waitForTimeout(4000);
    const deadline = Date.now() + 45000;
    let auth = null;
    let ct0 = null;
    while (Date.now() < deadline) {
      const cookies = await context.cookies('https://x.com');
      auth = cookies.find((c) => c.name === 'auth_token')?.value || null;
      ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
      if (auth && ct0) break;

      const text = await page.locator('body').innerText().catch(() => '');
      if (/verification code|confirm your email|suspicious|cloudflare|just a moment/i.test(text)) {
        throw new Error('X is asking for interactive verification or blocked the browser');
      }
      await page.waitForTimeout(1500);
    }

    if (!auth || !ct0) {
      throw new Error('Browser login did not produce auth_token/ct0 — X may have shown a captcha');
    }

    const all = await context.cookies();
    const relevant = all.filter((c) => /x\.com|twitter\.com/i.test(c.domain || ''));
    const jar = {};
    for (const c of relevant) jar[c.name] = c.value;
    jar.auth_token = auth;
    jar.ct0 = ct0;

    const cookieString = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      user: { username: user, id: '', name: '' },
      cookieString,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { loginWithBrowser };
