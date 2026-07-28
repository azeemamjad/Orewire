'use strict';

/**
 * CDP screencast + input relay so a VA can log into X from a password-gated webpage.
 */

/** DOM key / code → Windows virtual-key code for CDP Input.dispatchKeyEvent. */
function windowsVirtualKeyCode(key, code) {
  const k = String(key || '');
  const c = String(code || '');
  const byKey = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    Space: 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Insert: 45,
    Delete: 46,
  };
  if (byKey[k] != null) return byKey[k];
  if (/^Digit[0-9]$/.test(c)) return c.charCodeAt(5); // '0'..'9'
  if (/^Key[A-Z]$/.test(c)) return c.charCodeAt(3); // 'A'..'Z'
  if (k.length === 1) {
    const upper = k.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return upper.charCodeAt(0);
    if (upper >= '0' && upper <= '9') return upper.charCodeAt(0);
  }
  return 0;
}

class ScreencastHub {
  constructor(manager) {
    this.manager = manager;
    this.clients = new Set();
    this.cdp = null;
    this.page = null;
    this.running = false;
    this.viewport = { width: 1280, height: 800 };
  }

  async ensurePage() {
    if (!this.manager.isRunning()) {
      await this.manager.start({ headed: false });
    }
    this.page = await this.manager._getPage();
    const vp = this.page.viewportSize();
    if (vp) this.viewport = vp;
    return this.page;
  }

  async start() {
    if (this.running) return;
    const page = await this.ensurePage();
    this.cdp = await page.context().newCDPSession(page);
    this.running = true;

    this.cdp.on('Page.screencastFrame', async (frame) => {
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      } catch {
        /* ignore */
      }
      const msg = JSON.stringify({
        type: 'frame',
        data: frame.data,
        metadata: frame.metadata || {},
        viewport: this.viewport,
      });
      for (const ws of this.clients) {
        if (ws.readyState === 1) ws.send(msg);
      }
    });

    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
  }

  async stop() {
    this.running = false;
    if (this.cdp) {
      try {
        await this.cdp.send('Page.stopScreencast');
      } catch {
        /* ignore */
      }
      try {
        await this.cdp.detach();
      } catch {
        /* ignore */
      }
      this.cdp = null;
    }
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  async handleInput(msg) {
    if (!this.cdp || !this.page) await this.start();
    const type = msg?.type;
    if (type === 'mouse') {
      const { event, x, y, button = 'left', clickCount = 1 } = msg;
      const map = {
        move: 'mouseMoved',
        down: 'mousePressed',
        up: 'mouseReleased',
        wheel: 'mouseWheel',
      };
      const cdpType = map[event];
      if (!cdpType) return;
      const params = {
        type: cdpType,
        x: Number(x),
        y: Number(y),
        button,
        clickCount: Number(clickCount) || 1,
        modifiers: 0,
      };
      if (event === 'wheel') {
        params.deltaX = Number(msg.deltaX) || 0;
        params.deltaY = Number(msg.deltaY) || 0;
      }
      if (event === 'down' || event === 'up') {
        params.buttons = button === 'right' ? 2 : 1;
      }
      await this.cdp.send('Input.dispatchMouseEvent', params);
      return;
    }

    if (type === 'key') {
      const { event, key, code, text, modifiers = 0 } = msg;
      if (event === 'press' && text) {
        await this.cdp.send('Input.insertText', { text: String(text) });
        return;
      }

      // Editing / navigation keys need windowsVirtualKeyCode (and rawKeyDown)
      // or contenteditable fields on x.com ignore them (Backspace especially).
      const vk = windowsVirtualKeyCode(key, code);
      const isChar =
        event === 'press' ||
        (typeof text === 'string' && text.length > 0) ||
        (typeof key === 'string' && key.length === 1 && !vk);
      let cdpType;
      if (event === 'up') cdpType = 'keyUp';
      else if (isChar) cdpType = 'keyDown';
      else cdpType = 'rawKeyDown';

      const params = {
        type: cdpType,
        key: key || '',
        code: code || '',
        modifiers: Number(modifiers) || 0,
      };
      if (vk) {
        params.windowsVirtualKeyCode = vk;
        params.nativeVirtualKeyCode = vk;
      }
      if (isChar && text) {
        params.text = text;
        params.unmodifiedText = text;
      }
      await this.cdp.send('Input.dispatchKeyEvent', params);
      return;
    }

    if (type === 'navigate' && msg.url) {
      await this.page.goto(String(msg.url), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return;
    }

    if (type === 'open_login') {
      await this.manager.openLoginWindow();
      // reopen screencast on possibly new page
      await this.stop();
      await this.start();
      return;
    }
  }

  async openLoginForViewer() {
    await this.ensurePage();
    await this.page.goto('https://x.com/i/flow/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!this.running) await this.start();
    return { url: this.page.url() };
  }
}

module.exports = { ScreencastHub };
