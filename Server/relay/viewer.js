const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { verifyViewToken } = require('./tokens');
const { pool } = require('./pool');
const { STATUS } = require('./constants');
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

  const wss = new WebSocketServer({ noServer: true });
  const WS_PATH = '/relay/ws';

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    // Only claim /relay/ws — do NOT destroy other paths (e.g. /x-browser/ws).
    if (pathname !== WS_PATH) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (ws, req) => {
    let workerId = null;
    let screencastActive = false;
    let viewerCounted = false;
    let cdpRef = null;
    let onFrame = null;
    let cleanup = null;

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
      let worker;
      try {
        worker = await pool.attachViewer(workerId);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          message: err.message || 'Browser session is not available',
        }));
        ws.close(4002, err.message || 'Session error');
        return;
      }
      const { page, cdp, label, viewport } = worker;
      cdpRef = cdp;
      pool.incrementViewers(workerId);
      viewerCounted = true;

      ws.send(JSON.stringify({ type: 'ready', label, url: page.url(), viewport }));

      onFrame = (params) => {
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

      // Register the frame listener first; if startScreencast throws, the catch
      // below removes it via cdpRef/onFrame so it does not leak.
      cdp.on('Page.screencastFrame', onFrame);
      await startScreencast(cdp, viewport);
      screencastActive = true;

      const onNav = (frame) => {
        if (frame !== page.mainFrame() || ws.readyState !== ws.OPEN) return;
        try {
          worker.url = page.url();
          ws.send(JSON.stringify({ type: 'url', url: page.url() }));
        } catch { /* ignore */ }
      };
      page.on('framenavigated', onNav);

      // Tear down only THIS viewer's resources. The CDP screencast is shared by
      // every viewer of the worker, so it is stopped only when the last one
      // leaves — otherwise one disconnect would freeze the others.
      let cleanedUp = false;
      cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        page.off('framenavigated', onNav);
        cdp.off('Page.screencastFrame', onFrame);
        viewerCounted = false;
        const remaining = pool.decrementViewers(workerId);
        if (screencastActive && remaining === 0) {
          await stopScreencast(cdp);
        }
      };

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }

        // Stop must NOT wait in the per-worker queue — otherwise it can't
        // interrupt a hung page.goto (the goto IS the thing holding the queue).
        // Fire CDP Page.stopLoading out-of-band to abort the in-flight load
        // immediately; the pending goto then rejects and frees the queue, after
        // which the queued recovery blanks the page and resumes the screencast.
        if (msg.type === 'cancel_navigate') {
          worker.navGen = (worker.navGen || 0) + 1;
          cdp.send('Page.stopLoading').catch(() => {});
          ws.send(JSON.stringify({ type: 'cancelled' }));
          runQueued(workerId, async () => {
            try {
              await unstickPage(page);
              worker.url = page.url();
              ws.send(JSON.stringify({ type: 'url', url: page.url() }));
              if (screencastActive) await startScreencast(cdp, viewport);
            } catch (err) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
              }
            }
          });
          return;
        }

        // During captcha / needs_human the scraper yields the queue — run viewer
        // input at priority so a human can solve the wall without waiting behind
        // a long poll. While a task is running, viewer input still interleaves
        // between scraper steps because sessions no longer hold one queue lock.
        const viewerPriority = worker.status === STATUS.NEEDS_HUMAN;

        runQueued(workerId, async () => {
          try {
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
        }, { priority: viewerPriority });
      });

      ws.on('close', () => {
        cleanup().catch(() => {});
      });
    } catch (err) {
      if (cleanup) {
        // Fully wired — let the normal teardown run.
        cleanup().catch(() => {});
      } else {
        // Failed mid-setup: remove any partial listener and undo the view count
        // so we never leak a listener on the shared CDP session.
        try { cdpRef?.off?.('Page.screencastFrame', onFrame); } catch { /* ignore */ }
        if (viewerCounted) pool.decrementViewers(workerId);
      }
      ws.close(4002, err.message || 'Session error');
    }
  });

  return wss;
}

module.exports = { attachRelayViewer };
