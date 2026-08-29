#!/usr/bin/env node
/**
 * End-to-end check of the relay browser stack: spawn a real pool worker, attach
 * two viewers to its screen transport, walk the SEDAR+ search flow, push human
 * input through, then tear it all down and confirm the OS process is reaped.
 *
 *   npm run relay:test-engine
 *   RELAY_ENGINE=camoufox npm run relay:test-engine
 *
 * Run it under a display (./start-headed.sh style) so the worker is headed:
 *   xvfb-run -a node scripts/test-relay-engine.js
 */
require('dotenv').config();
const { pool } = require('../relay/pool');
const { detectCaptchaOnPage } = require('../relay/captcha');

const ID = 'itest-1';
let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${d ? ` — ${d}` : ''}`); };

(async () => {
  const w = await pool.spawnWorker({ id: ID, label: 'itest', url: 'about:blank', proxy: null });

  console.log('\n--- worker ---');
  const isChrome = w.engine === 'chrome';
  ok(!!w.engine, 'engine', w.engine);
  if (isChrome) {
    ok(w.channel === 'chrome', 'real Chrome channel (not bundled Chromium)', w.channel);
    ok(w.driver === 'patchright', 'patched driver', w.driver);
    ok(!!w.cdp, 'cdp session', String(!!w.cdp));
  }
  ok(w.headless === false, 'headed', String(w.headless));
  if (isChrome) ok(!!w.browserPid, 'pid resolved from profile dir', String(w.browserPid));
  ok(!!w.profileDir, 'persistent profile', w.profileDir);
  ok(pool.isWorkerHealthy(ID), 'healthy without a Browser handle');
  ok(w.viewport.width > 0 && w.viewport.height > 0, 'measured viewport',
     `${w.viewport.width}x${w.viewport.height}`);
  ok(!!w.geo?.timezoneId, 'geo resolved', JSON.stringify(w.geo));

  console.log('\n--- listWorkers (admin payload) ---');
  console.log(JSON.stringify(pool.listWorkers()[0], null, 1));

  console.log('\n--- viewer transport ---');
  let frames = 0;
  let lastFrame = null;
  const detach = await w.screen.attach((f) => { frames++; lastFrame = f; });
  ok(w.screen.capturing, 'capture started on first attach');

  // second viewer must share the same capture
  let frames2 = 0;
  const detach2 = await w.screen.attach(() => { frames2++; });
  ok(w.screen.viewerCount === 2, 'two viewers share one capture', String(w.screen.viewerCount));

  await w.page.goto('https://www.sedarplus.ca/home/', { waitUntil: 'load', timeout: 90000 });
  await w.page.waitForTimeout(2500);
  ok(frames > 0, 'viewer 1 received frames', `${frames} frames`);
  ok(frames2 > 0, 'viewer 2 received frames', `${frames2} frames`);
  ok(lastFrame && lastFrame.data && lastFrame.data.length > 1000, 'frames carry jpeg data',
     lastFrame ? `${lastFrame.data.length} b64 chars, ${lastFrame.w}x${lastFrame.h}` : 'none');

  const remaining = await detach2();
  ok(w.screen.capturing === true, 'capture survives one viewer leaving', `${remaining} left`);

  console.log('\n--- SEDAR+ flow through the relay worker ---');
  const pause = (a, b) => w.page.waitForTimeout(a + Math.floor(Math.random() * (b - a)));
  const step = async (label, fn) => {
    try {
      await fn();
      const walled = await detectCaptchaOnPage(w.page);
      ok(!walled, label, walled ? `BOT WALL @ ${w.page.url()}` : w.page.url().slice(0, 80));
      return !walled;
    } catch (e) { ok(false, label, e.message.split('\n')[0].slice(0, 120)); return false; }
  };
  let good = await step('click "Search SEDAR+"', async () => {
    const l = w.page.getByRole('link', { name: /search sedar/i }).first();
    await l.waitFor({ state: 'visible', timeout: 20000 }); await l.click(); await pause(600, 1200);
  });
  if (good) good = await step('click "Documents"', async () => {
    const l = w.page.getByRole('link', { name: /^documents$/i }).first();
    await l.waitFor({ state: 'visible', timeout: 20000 }); await l.click(); await pause(600, 1200);
  });
  if (good) good = await step('search form renders', async () => {
    await w.page.waitForSelector('input[placeholder="Profile name or number"]', { state: 'visible', timeout: 40000 });
  });

  console.log('\n--- human input through the screen abstraction ---');
  const before = frames;
  await w.screen.mouse({ event: 'move', x: 200, y: 200, displayW: w.viewport.width, displayH: w.viewport.height });
  const r = await w.screen.mouse({ event: 'click', x: 200, y: 200, displayW: w.viewport.width, displayH: w.viewport.height });
  ok(!!r, 'mouse click dispatched', JSON.stringify(r));
  await w.screen.key({ event: 'keydown', key: 'a' });
  ok(true, 'key dispatched');

  // A CDP screencast only emits on repaint, so clicking static content can
  // legitimately produce zero frames. Scroll instead: that always repaints, and
  // it exercises the wheel path through the screen abstraction at the same time.
  await w.screen.mouse({
    event: 'wheel', x: 400, y: 400, deltaY: 500,
    displayW: w.viewport.width, displayH: w.viewport.height,
  });
  await w.page.waitForTimeout(w.screen.supportsCdp ? 1500 : 3000);
  ok(frames > before, 'frames flow after a repaint-causing input', `${frames - before} new`);

  console.log('\n--- teardown ---');
  await detach();
  ok(!w.screen.capturing, 'capture stopped when last viewer left');

  const pid = w.browserPid;
  await pool.closeWorker(ID);
  await new Promise((r2) => setTimeout(r2, 1500));
  if (pid) {
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    ok(!alive, 'browser process reaped', `pid ${pid}`);
  }
  ok(pool.getWorker(ID) === null, 'worker slot removed');

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
