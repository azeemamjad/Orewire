'use strict';

const fs = require('fs');
const { profileDir } = require('./config');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureProfileDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function wipeProfileDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

class HostedBrowserManager {
  constructor() {
    this.context = null;
    this.headed = false;
    this._startLock = null;
    this._postLock = null;
  }

  getProfileDir() {
    return profileDir();
  }

  isRunning() {
    return !!this.context;
  }

  async start({ headed = false } = {}) {
    if (this._startLock) return this._startLock;
    this._startLock = this._startInner({ headed }).finally(() => {
      this._startLock = null;
    });
    return this._startLock;
  }

  async _startInner({ headed = false } = {}) {
    if (this.context && this.headed === !!headed) {
      return this.status();
    }
    if (this.context) {
      await this._closeContext();
    }

    const userDataDir = this.getProfileDir();
    ensureProfileDir(userDataDir);

    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch {
      throw new Error('Playwright is not available');
    }

    // Use full Chromium for both headed login and headless posts (not headless_shell-only).
    if (process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL == null) {
      process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = '0';
    }

    this.headed = !!headed;
    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: !this.headed,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      userAgent: USER_AGENT,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });

    this.context.on('close', () => {
      this.context = null;
      this.headed = false;
    });

    console.log(
      `[hosted-browser] Started (${this.headed ? 'headed' : 'headless'}) profile=${userDataDir}`,
    );
    return this.status();
  }

  async stop() {
    await this._closeContext();
    console.log('[hosted-browser] Stopped');
    return this.status();
  }

  async _closeContext() {
    const ctx = this.context;
    this.context = null;
    this.headed = false;
    if (!ctx) return;
    try {
      await ctx.close();
    } catch (err) {
      console.warn('[hosted-browser] Context close warning:', err?.message || err);
    }
  }

  async cookiesLoggedIn() {
    if (!this.context) return false;
    try {
      const cookies = await this.context.cookies(['https://x.com', 'https://twitter.com']);
      const names = new Set(cookies.map((c) => c.name));
      return names.has('auth_token') && names.has('ct0');
    } catch {
      return false;
    }
  }

  /**
   * Heuristic: auth_token + ct0 cookies, or x.com home without login CTA.
   */
  async isLoggedIn() {
    if (!this.context) return false;
    if (await this.cookiesLoggedIn()) return true;

    let page;
    try {
      page = await this.context.newPage();
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(800);
      const url = page.url();
      if (/\/(login|i\/flow\/login)/i.test(url)) return false;
      const loginCta = await page
        .locator('a[href="/login"], a[href*="/i/flow/login"]')
        .first()
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      if (loginCta) return false;
      const composer = await page
        .locator('[data-testid="tweetTextarea_0"], [data-testid="SideNav_AccountSwitcher_Button"]')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      return !!composer;
    } catch {
      return false;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async status() {
    const running = this.isRunning();
    let loggedIn = false;
    if (running) {
      loggedIn = await this.cookiesLoggedIn();
      if (!loggedIn) {
        // Light cookie-only status by default; full home check is expensive.
        // Callers that need a deep check can use isLoggedIn().
      }
    }
    return {
      running,
      headed: running ? this.headed : false,
      loggedIn,
      profileDir: this.getProfileDir(),
    };
  }

  /**
   * Open a headed Chromium window on X login so the VA can authenticate once.
   * Session cookies persist in the profile dir.
   */
  async openLoginWindow() {
    await this.start({ headed: true });
    const page = this.context.pages()[0] || (await this.context.newPage());
    await page.goto('https://x.com/i/flow/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const st = await this.status();
    st.loggedIn = await this.isLoggedIn();
    return { ...st, loginUrl: page.url() };
  }

  /**
   * Clear session and wipe the persistent profile so VA must log in again.
   */
  async logout() {
    if (this.context) {
      try {
        await this.context.clearCookies();
      } catch (err) {
        console.warn('[hosted-browser] clearCookies:', err?.message || err);
      }
    }
    await this._closeContext();

    const dir = this.getProfileDir();
    try {
      wipeProfileDir(dir);
    } catch (err) {
      // Retry once after a short delay (Chromium may still hold files briefly)
      await sleep(500);
      wipeProfileDir(dir);
    }

    console.log('[hosted-browser] Logged out — profile wiped');
    return this.status();
  }

  async _getPage() {
    if (!this.context) throw new Error('Hosted browser is not running');
    const existing = this.context.pages().find((p) => !p.isClosed());
    if (existing) return existing;
    return this.context.newPage();
  }

  async _fillComposeBox(page, index, text) {
    const sel = `[data-testid="tweetTextarea_${index}"]`;
    await page.waitForSelector(sel, { timeout: 45_000 });
    const root = page.locator(sel).first();
    const editable = root.locator('[contenteditable="true"]').first();
    const target = (await editable.count()) > 0 ? editable : root;

    await target.click({ timeout: 10_000 });
    await sleep(200);

    // Clear then insert via clipboard-style events (X compose listens for these)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await sleep(100);

    const payload = String(text);
    const ok = await page.evaluate(({ selector, value }) => {
      const rootEl = document.querySelector(selector);
      if (!rootEl) return false;
      const el =
        rootEl.querySelector('[contenteditable="true"]') ||
        (rootEl.getAttribute('contenteditable') === 'true' ? rootEl : null) ||
        rootEl;
      el.focus();
      const selectAll = () => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selApi = window.getSelection();
        selApi.removeAllRanges();
        selApi.addRange(range);
      };
      const read = () => (el.innerText || el.textContent || '').replace(/\u200B/g, '').trim();
      selectAll();
      try {
        document.execCommand('delete', false);
      } catch (_) {}
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', value);
        el.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
        );
      } catch (_) {}
      if (!read()) {
        try {
          selectAll();
          document.execCommand('insertText', false, value);
        } catch (_) {}
      }
      if (!read()) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      }
      return read().length > 0;
    }, { selector: sel, value: payload });

    if (!ok) {
      // Fallback: Playwright type
      await target.type(payload, { delay: 8 });
    }

    await sleep(300);
    for (let i = 0; i < 25; i++) {
      const enabled = await page.evaluate(() => {
        const btn = document.querySelector(
          '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
        );
        if (!btn) return false;
        return btn.getAttribute('aria-disabled') !== 'true';
      });
      const len = await page.evaluate((selector) => {
        const rootEl = document.querySelector(selector);
        if (!rootEl) return 0;
        const el = rootEl.querySelector('[contenteditable="true"]') || rootEl;
        return (el.innerText || el.textContent || '').replace(/\u200B/g, '').trim().length;
      }, sel);
      if (len > 0 && enabled) return;
      await sleep(200);
    }
  }

  async _clickAddPost(page) {
    return page.evaluate(() => {
      const btn =
        document.querySelector('[data-testid="addButton"]') ||
        document.querySelector('button[aria-label="Add post"]') ||
        document.querySelector('button[aria-label*="Add another"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
  }

  async _clickPostButton(page) {
    let last = { ok: false, reason: 'missing' };
    for (let i = 0; i < 25; i++) {
      last = await page.evaluate(() => {
        const btns = [
          ...document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'),
        ];
        const btn =
          btns.find((b) => /post all/i.test((b.innerText || b.textContent || '').trim())) ||
          btns.find((b) => /^(post|reply)$/i.test((b.innerText || b.textContent || '').trim())) ||
          btns[0];
        if (!btn) return { ok: false, reason: 'missing' };
        if (btn.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'disabled' };
        btn.click();
        return { ok: true };
      });
      if (last?.ok) {
        await sleep(500);
        return;
      }
      await sleep(200);
    }
    throw new Error(`Post button not found (${last?.reason || 'unknown'})`);
  }

  async _waitForThreadUrl(page, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(800);
      const found = await page.evaluate(() => {
        if (/\/status\/\d+/.test(location.href)) return location.href.split('?')[0];
        const toast = document.querySelector('[data-testid="toast"] a[href*="/status/"]');
        if (toast && toast.href) return toast.href.split('?')[0];
        const composeOpen = !!document.querySelector('[data-testid="tweetTextarea_0"]');
        if (!composeOpen) return 'posted';
        return null;
      });
      if (typeof found === 'string' && found.startsWith('http')) return found;
      if (found === 'posted') return null;
    }
    return null;
  }

  async _replyToStatus(page, statusUrl, text) {
    await page.goto(statusUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(1200);
    const replied = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reply"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!replied) throw new Error('Reply button not found');
    await sleep(800);
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 20_000 });
    await this._fillComposeBox(page, 0, text);
    await this._clickPostButton(page);
    await sleep(1200);
    return statusUrl;
  }

  /**
   * @param {{ tweets?: string[] }} args
   */
  async postXThread(args = {}) {
    if (this._postLock) {
      throw new Error('A hosted-browser post is already in progress');
    }
    this._postLock = true;
    try {
      if (!this.context) {
        await this.start({ headed: false });
      }
      if (!(await this.cookiesLoggedIn()) && !(await this.isLoggedIn())) {
        throw new Error('Not logged in to X — use Open login first');
      }

      const tweets = Array.isArray(args.tweets)
        ? args.tweets.map((t) => String(t ?? '').trim()).filter(Boolean)
        : [];
      if (!tweets.length) throw new Error('tweets (string[]) is required');

      const page = await this._getPage();
      await page.goto('https://x.com/compose/post', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await sleep(1200);
      await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 45_000 });
      await sleep(400);

      if (tweets.length === 1) {
        await this._fillComposeBox(page, 0, tweets[0]);
        await this._clickPostButton(page);
        const threadUrl = await this._waitForThreadUrl(page);
        return { ok: true, tweetCount: 1, threadUrl, mode: 'single', via: 'hosted-browser' };
      }

      try {
        for (let i = 0; i < tweets.length; i++) {
          await this._fillComposeBox(page, i, tweets[i]);
          if (i < tweets.length - 1) {
            const added = await this._clickAddPost(page);
            if (!added) throw new Error('addButton missing');
            await sleep(800);
            let ok = false;
            for (let t = 0; t < 25; t++) {
              ok = await page.evaluate(
                (idx) => !!document.querySelector(`[data-testid="tweetTextarea_${idx}"]`),
                i + 1,
              );
              if (ok) break;
              await sleep(300);
            }
            if (!ok) throw new Error(`tweetTextarea_${i + 1} not found after add`);
          }
        }
        await this._clickPostButton(page);
        const threadUrl = await this._waitForThreadUrl(page);
        return {
          ok: true,
          tweetCount: tweets.length,
          threadUrl,
          mode: 'compose_thread',
          via: 'hosted-browser',
        };
      } catch (err) {
        console.warn(
          '[hosted-browser] Compose-thread failed, reply-chain fallback:',
          err.message || err,
        );
      }

      await page.goto('https://x.com/compose/post', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await sleep(1000);
      await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 45_000 });
      await this._fillComposeBox(page, 0, tweets[0]);
      await this._clickPostButton(page);
      const threadUrl = await this._waitForThreadUrl(page);
      if (!threadUrl) {
        throw new Error('Posted first tweet but could not capture status URL for replies');
      }
      for (let i = 1; i < tweets.length; i++) {
        await this._replyToStatus(page, threadUrl, tweets[i]);
      }
      return {
        ok: true,
        tweetCount: tweets.length,
        threadUrl,
        mode: 'reply_chain',
        via: 'hosted-browser',
      };
    } finally {
      this._postLock = null;
    }
  }
}

module.exports = { HostedBrowserManager, wipeProfileDir, ensureProfileDir };
