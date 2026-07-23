'use strict';

/**
 * CDP screencast + input relay so a VA can log into X from a password-gated webpage.
 */

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
      const cdpType = event === 'up' ? 'keyUp' : 'keyDown';
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: cdpType,
        key: key || '',
        code: code || '',
        text: text || undefined,
        unmodifiedText: text || undefined,
        modifiers: Number(modifiers) || 0,
      });
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
