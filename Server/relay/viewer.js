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

const { findCaptchaClickTarget } = require('./cdp-input');

const VIEW_HTML = fs.readFileSync(path.join(__dirname, '../public/relay/view.html'), 'utf8');

const NAV_TIMEOUT_MS = parseInt(process.env.RELAY_NAV_TIMEOUT_MS || '45000', 10);

function normalizeNavigateUrl(input) {
  return assertAllowedNavigationUrl(input);
}

async function unstickPage(page) {
  try {
    await page.evaluate(() => window.stop());
  } catch { /* ignore */ }
  try {
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 15000 });
  } catch { /* ignore */ }
}

async function navigatePage(page, worker, ws, input) {
  const url = normalizeNavigateUrl(input);
  const gen = ++worker.navGen;
  ws.send(JSON.stringify({ type: 'navigating', url }));

  // Pause capture across the navigation: a screencast held open through a
  // cross-document load streams stale frames and, on some pages, wedges.
  await worker.screen.pause();

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
        await worker.screen.resume();
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: `Screencast resume failed: ${e.message}` }));
      }
    }
  }
}

async function handleInput(worker, msg) {
  if (msg.type === 'mouse') {
    return worker.screen.mouse(msg);
  }
  if (msg.type === 'key') {
    await worker.screen.key(msg);
  }
  return null;
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
    let viewerCounted = false;
    let detach = null;
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
      const { page, label, viewport, screen } = worker;
      if (!screen) throw new Error('Worker has no screen transport — respawn it');
      pool.incrementViewers(workerId);
      viewerCounted = true;

      ws.send(JSON.stringify({
        type: 'ready',
        label,
        url: page.url(),
        viewport,
        engine: worker.engine || null,
        // Firefox/Camoufox workers stream polled screenshots rather than a CDP
        // screencast, so the UI can tell the operator why it looks choppier.
        transport: screen.supportsCdp ? 'screencast' : 'poll',
        needsHuman: worker.status === STATUS.NEEDS_HUMAN,
      }));

      const onFrame = (frame) => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          ws.send(JSON.stringify({ type: 'frame', data: frame.data, w: frame.w, h: frame.h }));
        } catch { /* connection closing */ }
      };

      // The capture is shared across viewers and refcounted inside the screen:
      // attaching a second viewer does not start a second stream, and detaching
      // one does not freeze the others.
      detach = await screen.attach(onFrame);

      const onNav = (frame) => {
        if (frame !== page.mainFrame() || ws.readyState !== ws.OPEN) return;
        try {
          worker.url = page.url();
          ws.send(JSON.stringify({ type: 'url', url: page.url() }));
        } catch { /* ignore */ }
      };
      page.on('framenavigated', onNav);

      // Tear down only THIS viewer's resources — the shared capture stops on its
      // own once the last listener detaches.
      let cleanedUp = false;
      cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        page.off('framenavigated', onNav);
        if (detach) await detach().catch(() => {});
        viewerCounted = false;
        pool.decrementViewers(workerId);
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
          screen.stopLoading().catch(() => {});
          ws.send(JSON.stringify({ type: 'cancelled' }));
          runQueued(workerId, async () => {
            try {
              await unstickPage(page);
              worker.url = page.url();
              ws.send(JSON.stringify({ type: 'url', url: page.url() }));
              await screen.resume();
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
        const viewerPriority = worker.status === STATUS.NEEDS_HUMAN || !worker.busy;

        runQueued(workerId, async () => {
          try {
            if (msg.type === 'navigate') {
              await navigatePage(page, worker, ws, msg.url);
              return;
            }
            if (msg.type === 'refresh') {
              const target = page.url() && page.url() !== 'about:blank'
                ? page.url()
                : 'about:blank';
              await navigatePage(page, worker, ws, target);
              return;
            }
            if (msg.type === 'find_captcha') {
              const target = await findCaptchaClickTarget(page);
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'captcha_target', target }));
              }
              return;
            }
            const result = await handleInput(worker, msg);
            if (result && ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'input_ack', ...result }));
            }
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
        // Failed mid-setup: detach any partial listener and undo the view count
        // so we never leak a listener on the shared capture.
        if (detach) await detach().catch(() => {});
        if (viewerCounted) pool.decrementViewers(workerId);
      }
      ws.close(4002, err.message || 'Session error');
    }
  });

  return wss;
}

module.exports = { attachRelayViewer };
