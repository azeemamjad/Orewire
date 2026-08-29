/**
 * Viewer transport — how the relay streams a worker's screen to the admin UI
 * and pushes human input back.
 *
 * Chromium gives us CDP: `Page.startScreencast` pushes JPEG frames as they are
 * painted, and `Input.dispatch*` injects events the page sees as trusted. That
 * is the fast path and stays exactly as it was.
 *
 * Camoufox is Firefox — no CDP at all. Rather than lose the live view on the
 * engine we fall back to when Chromium is losing, it degrades to screenshot
 * polling with Playwright-level input. Noticeably slower, still fully
 * interactive: enough for a human to click through a captcha.
 *
 * Both share one capture per worker, fanned out to every attached viewer, so a
 * second admin opening the view does not start a second screencast (and one
 * closing does not freeze the others).
 */
const { dispatchCdpMouse } = require('./cdp-input');

// Each poll is a real page.screenshot(), which briefly occupies the renderer.
// Polling too hot starves the page: at 400ms a plain locator.click() on a slow
// site could miss a 30s actionability timeout. ~1.5 fps is still fine for a
// human watching and clicking through a captcha.
const POLL_MS = parseInt(process.env.RELAY_POLL_FPS_MS || '700', 10);
const POLL_QUALITY = parseInt(process.env.RELAY_POLL_QUALITY || '60', 10);

function createScreen(worker) {
  const listeners = new Set();
  let capturing = false;
  let cdpFrameHandler = null;
  let pollTimer = null;

  const viewportOf = () => worker.viewport || { width: 1280, height: 900 };

  function emit(frame) {
    for (const fn of listeners) {
      try { fn(frame); } catch { /* one bad viewer must not kill the rest */ }
    }
  }

  // ---- CDP path -----------------------------------------------------------

  async function startCdpCapture() {
    const { cdp } = worker;
    const viewport = viewportOf();
    cdpFrameHandler = (params) => {
      emit({ data: params.data, w: viewport.width, h: viewport.height });
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', cdpFrameHandler);
    await cdp.send('Page.enable');
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });
  }

  async function stopCdpCapture() {
    const { cdp } = worker;
    if (cdpFrameHandler && cdp) {
      try { cdp.off('Page.screencastFrame', cdpFrameHandler); } catch { /* ignore */ }
      cdpFrameHandler = null;
    }
    try { await cdp?.send('Page.stopScreencast'); } catch { /* ignore */ }
  }

  // ---- Polling path (Firefox / Camoufox) ----------------------------------

  function startPollCapture() {
    let inFlight = false;
    pollTimer = setInterval(async () => {
      // Skip rather than queue: a slow screenshot must not build a backlog that
      // shows the human a screen from ten seconds ago.
      if (inFlight || !listeners.size) return;
      inFlight = true;
      try {
        const buf = await worker.page.screenshot({ type: 'jpeg', quality: POLL_QUALITY });
        const viewport = viewportOf();
        emit({ data: buf.toString('base64'), w: viewport.width, h: viewport.height });
      } catch {
        /* page navigating or closed — next tick will catch up */
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    if (pollTimer.unref) pollTimer.unref();
  }

  function stopPollCapture() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---- Shared lifecycle ---------------------------------------------------

  async function startCapture() {
    if (capturing) return;
    if (worker.supportsCdp && worker.cdp) await startCdpCapture();
    else startPollCapture();
    capturing = true;
  }

  async function stopCapture() {
    if (!capturing) return;
    if (worker.supportsCdp && worker.cdp) await stopCdpCapture();
    else stopPollCapture();
    capturing = false;
  }

  return {
    get supportsCdp() { return !!(worker.supportsCdp && worker.cdp); },
    get viewerCount() { return listeners.size; },
    get capturing() { return capturing; },

    /** Attach a viewer. Resolves to a detach function. */
    async attach(onFrame) {
      listeners.add(onFrame);
      try {
        await startCapture();
      } catch (err) {
        listeners.delete(onFrame);
        throw err;
      }
      let detached = false;
      return async () => {
        if (detached) return 0;
        detached = true;
        listeners.delete(onFrame);
        if (listeners.size === 0) await stopCapture().catch(() => {});
        return listeners.size;
      };
    },

    /** Pause/resume capture around a navigation. */
    async pause() { await stopCapture().catch(() => {}); },
    async resume() { if (listeners.size) await startCapture(); },

    /** Abort an in-flight navigation without waiting on the page's JS. */
    async stopLoading() {
      if (worker.supportsCdp && worker.cdp) {
        try { await worker.cdp.send('Page.stopLoading'); return; } catch { /* fall through */ }
      }
      try { await worker.page.evaluate(() => window.stop()); } catch { /* ignore */ }
    },

    /**
     * Human mouse input. CDP dispatch is more reliable on captcha widgets
     * (it reaches closed shadow roots and cross-origin iframes); Playwright's
     * mouse is the portable equivalent.
     */
    async mouse(msg) {
      const viewport = viewportOf();
      if (worker.supportsCdp && worker.cdp) {
        return dispatchCdpMouse(worker.cdp, msg, viewport);
      }

      const vw = viewport.width;
      const vh = viewport.height;
      const dw = msg.displayW > 0 ? msg.displayW : vw;
      const dh = msg.displayH > 0 ? msg.displayH : vh;
      const x = Math.round((Math.max(0, Math.min(msg.x ?? 0, dw)) / dw) * vw);
      const y = Math.round((Math.max(0, Math.min(msg.y ?? 0, dh)) / dh) * vh);
      const button = msg.button === 2 ? 'right' : msg.button === 1 ? 'middle' : 'left';
      const { mouse } = worker.page;

      if (msg.event === 'move') { await mouse.move(x, y); return { x, y, event: 'move' }; }
      if (msg.event === 'down') { await mouse.move(x, y); await mouse.down({ button }); return { x, y, event: 'down' }; }
      if (msg.event === 'up') { await mouse.up({ button }); return { x, y, event: 'up' }; }
      if (msg.event === 'click') {
        await mouse.click(x, y, { button, clickCount: msg.clickCount || 1 });
        return { x, y, event: 'click' };
      }
      if (msg.event === 'wheel') {
        await mouse.move(x, y);
        await mouse.wheel(0, msg.deltaY || 0);
        return { x, y, event: 'wheel' };
      }
      return null;
    },

    /** Human keyboard input. */
    async key(msg) {
      if (msg.event !== 'keydown' || !msg.key) return;
      if (msg.key.length === 1 && worker.supportsCdp && worker.cdp) {
        await worker.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: msg.key, key: msg.key });
        await worker.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: msg.key });
        return;
      }
      if (msg.key.length === 1) {
        await worker.page.keyboard.type(msg.key);
        return;
      }
      await worker.page.keyboard.press(msg.key);
    },
  };
}

module.exports = { createScreen };
