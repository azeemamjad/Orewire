/** Low-level mouse/keyboard via CDP — more reliable than Playwright for captcha widgets. */

function cdpButton(button = 0) {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}

function cdpButtonsMask(button = 0) {
  if (button === 2) return 2;
  if (button === 1) return 4;
  return 1;
}

async function getClickScale(cdp, viewportW, viewportH) {
  try {
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const vv = metrics.visualViewport || metrics.layoutViewport;
    const cw = vv?.clientWidth || viewportW;
    const ch = vv?.clientHeight || viewportH;
    if (!cw || !ch || !viewportW || !viewportH) return { sx: 1, sy: 1 };
    return { sx: viewportW / cw, sy: viewportH / ch };
  } catch {
    return { sx: 1, sy: 1 };
  }
}

async function dispatchCdpMouse(cdp, msg, viewport) {
  const vw = viewport.width || viewport.w || 1280;
  const vh = viewport.height || viewport.h || 900;
  const dw = msg.displayW > 0 ? msg.displayW : vw;
  const dh = msg.displayH > 0 ? msg.displayH : vh;
  const clampedX = Math.max(0, Math.min(msg.x ?? 0, dw));
  const clampedY = Math.max(0, Math.min(msg.y ?? 0, dh));
  let x = Math.round((clampedX / dw) * vw);
  let y = Math.round((clampedY / dh) * vh);

  const { sx, sy } = await getClickScale(cdp, vw, vh);
  x = Math.round(x * sx);
  y = Math.round(y * sy);

  const button = cdpButton(msg.button);
  const btnMask = cdpButtonsMask(msg.button);
  const event = msg.event;

  if (event === 'move') {
    const params = { type: 'mouseMoved', x, y };
    if (msg.buttons > 0) params.buttons = msg.buttons;
    await cdp.send('Input.dispatchMouseEvent', params);
    return { x, y, event };
  }

  if (event === 'down') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons: btnMask,
      clickCount: 1,
    });
    return { x, y, event };
  }

  if (event === 'up') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: msg.clickCount || 1,
    });
    return { x, y, event };
  }

  if (event === 'click') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount: msg.clickCount || 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: msg.clickCount || 1,
    });
    return { x, y, event };
  }

  if (event === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY: msg.deltaY || 0,
    });
    return { x, y, event };
  }

  return null;
}

/** Locate visible captcha / bot-wall widget center (viewport coords). */
async function findCaptchaClickTarget(page) {
  return page.evaluate(() => {
    const candidates = [
      '#px-captcha',
      '.px-captcha',
      '#px-captcha-wrapper',
      'iframe[src*="captcha"]',
      'iframe[src*="perfdrive"]',
      'iframe[title*="captcha" i]',
      '.cf-turnstile',
      '#challenge-form input[type="button"]',
      '#challenge-form button',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const vis = r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
      if (!vis) continue;
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
        selector: sel,
      };
    }
    return null;
  }).catch(() => null);
}

module.exports = {
  dispatchCdpMouse,
  findCaptchaClickTarget,
};
