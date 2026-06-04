const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { verifyViewToken } = require('./tokens');
const { pool } = require('./pool');
const { runQueued } = require('./worker-queue');
const {
  assertValidViewTokenParam,
  assertAllowedNavigationUrl,
  escapeJsString,
} = require('./security');

const VIEW_HTML = fs.readFileSync(path.join(__dirname, '../public/relay/view.html'), 'utf8');

const NAV_TIMEOUT_MS = parseInt(process.env.RELAY_NAV_TIMEOUT_MS || '45000', 10);

function viewportSize(viewport) {
  return {
    w: viewport.width || viewport.w || 1280,
    h: viewport.height || viewport.h || 900,
  };
}

function scalePoint(x, y, displayW, displayH, viewportW, viewportH) {
  const dw = displayW > 0 ? displayW : viewportW;
  const dh = displayH > 0 ? displayH : viewportH;
  const clampedX = Math.max(0, Math.min(x, dw));
  const clampedY = Math.max(0, Math.min(y, dh));
  return {
    x: Math.round((clampedX / dw) * viewportW),
    y: Math.round((clampedY / dh) * viewportH),
  };
}

function normalizeNavigateUrl(input) {
  return assertAllowedNavigationUrl(input);
}

async function stopScreencast(cdp) {
  try {
    await cdp.send('Page.stopScreencast');
  } catch { /* ignore */ }
}

async function startScreencast(cdp, viewport) {
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
}

async function unstickPage(page) {
  try {
    await page.evaluate(() => window.stop());
  } catch { /* ignore */ }
  try {
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 15000 });
  } catch { /* ignore */ }
}

async function navigatePage(page, worker, ws, cdp, viewport, input) {
  const url = normalizeNavigateUrl(input);
  const gen = ++worker.navGen;
  ws.send(JSON.stringify({ type: 'navigating', url }));

  await stopScreencast(cdp);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    if (worker.navGen !== gen) return;
    worker.url = page.url();
    worker.lastError = null;
    ws.send(JSON.stringify({ type: 'url', url: page.url() }));
  } catch (err) {
    if (worker.navGen !== gen) return;
    worker.lastError = err.message;
    await unstickPage(page);
    worker.url = page.url();
    ws.send(JSON.stringify({ type: 'url', url: page.url() }));
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Navigation failed or timed out. Browser reset to blank page.',
    }));
  } finally {
    if (worker.navGen === gen) {
      try {
        await startScreencast(cdp, viewport);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: `Screencast resume failed: ${e.message}` }));
      }
    }
  }
}

function cancelNavigation(worker, ws) {
  worker.navGen = (worker.navGen || 0) + 1;
  ws.send(JSON.stringify({ type: 'cancelled' }));
}

async function handleInput(page, msg, viewport) {
  const { w: vw, h: vh } = viewportSize(viewport);
  const dw = msg.displayW > 0 ? msg.displayW : vw;
  const dh = msg.displayH > 0 ? msg.displayH : vh;
  const { x, y } = scalePoint(msg.x ?? 0, msg.y ?? 0, dw, dh, vw, vh);
  const button = msg.button === 2 ? 'right' : 'left';

  switch (msg.type) {
    case 'mouse':
      if (msg.event === 'move') {
        await page.mouse.move(x, y);
      } else if (msg.event === 'down') {
        await page.mouse.move(x, y);
        await page.mouse.down({ button });
      } else if (msg.event === 'up') {
        await page.mouse.move(x, y);
        await page.mouse.up({ button });
      } else if (msg.event === 'click') {
        await page.mouse.click(x, y, { button });
      } else if (msg.event === 'wheel') {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, msg.deltaY || 0);
      }
      break;
    case 'key':
      if (msg.event === 'keydown' && msg.key) {
        if (msg.key.length === 1) {
          await page.keyboard.type(msg.key);
        } else {
          await page.keyboard.press(msg.key);
        }
      }
      break;
    default:
      break;
  }
}

function attachRelayViewer(app, httpServer) {
  app.get('/relay/view/:token', (req, res) => {
    const tokenParam = req.params.token;
    if (!assertValidViewTokenParam(tokenParam)) {
      return res.status(400).send('Invalid view link.');
    }
    const verified = verifyViewToken(tokenParam);
    if (!verified) {
      return res.status(401).send('This view link is invalid or expired.');
    }
    const worker = pool.getWorker(verified.workerId);
    if (!worker) {
      return res.status(404).send('Browser session no longer exists.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; script-src 'unsafe-inline'");
    const html = VIEW_HTML.replace('__TOKEN__', escapeJsString(tokenParam));
    res.type('html').send(html);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/relay/ws' });

  wss.on('connection', async (ws, req) => {
    let workerId = null;
    let screencastActive = false;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!assertValidViewTokenParam(token)) {
        ws.close(4001, 'Invalid token');
        return;
      }
      const verified = verifyViewToken(token);
      if (!verified) {
        ws.close(4001, 'Invalid or expired token');
        return;
      }
      workerId = verified.workerId;
      const worker = await pool.attachViewer(workerId);
      const { page, cdp, label, viewport } = worker;
      pool.incrementViewers(workerId);

      ws.send(JSON.stringify({ type: 'ready', label, url: page.url(), viewport }));

      const onFrame = (params) => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          ws.send(
            JSON.stringify({
              type: 'frame',
              data: params.data,
              w: viewport.width,
              h: viewport.height,
            })
          );
        } catch { /* connection closing */ }
        cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
      };

      cdp.on('Page.screencastFrame', onFrame);
      await startScreencast(cdp, viewport);
      screencastActive = true;

      const pushUrl = () => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          worker.url = page.url();
          ws.send(JSON.stringify({ type: 'url', url: page.url() }));
        } catch { /* ignore */ }
      };
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) pushUrl();
      });

      ws.on('message', (raw) => {
        runQueued(workerId, async () => {
          try {
            const msg = JSON.parse(String(raw));
            if (msg.type === 'cancel_navigate') {
              cancelNavigation(worker, ws);
              await unstickPage(page);
              worker.url = page.url();
              ws.send(JSON.stringify({ type: 'url', url: page.url() }));
              if (screencastActive) await startScreencast(cdp, viewport);
              return;
            }
            if (msg.type === 'navigate') {
              await navigatePage(page, worker, ws, cdp, viewport, msg.url);
              return;
            }
            if (msg.type === 'refresh') {
              const target = page.url() && page.url() !== 'about:blank'
                ? page.url()
                : 'about:blank';
              await navigatePage(page, worker, ws, cdp, viewport, target);
              return;
            }
            await handleInput(page, msg, viewport);
          } catch (err) {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
          }
        });
      });

      ws.on('close', async () => {
        page.removeAllListeners('framenavigated');
        pool.decrementViewers(workerId);
        cdp.off('Page.screencastFrame', onFrame);
        if (screencastActive) {
          await stopScreencast(cdp);
        }
      });
    } catch (err) {
      if (workerId) pool.decrementViewers(workerId);
      ws.close(4002, err.message || 'Session error');
    }
  });

  return wss;
}

module.exports = { attachRelayViewer };
