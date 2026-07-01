const path = require('path');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(min = 300, max = 900) {
  await new Promise((r) => setTimeout(r, randomInt(min, max)));
}

// Longer "reading" pause — used between page steps to look less robotic.
async function humanReadPause() {
  await humanDelay(1200, 3200);
}

// Scroll the page in a few human-sized increments (with small pauses), so the
// session shows scroll events rather than instant DOM reads.
async function humanScroll(page) {
  try {
    const steps = randomInt(2, 4);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, randomInt(180, 520));
      await humanDelay(250, 700);
    }
    if (Math.random() < 0.5) {
      await page.mouse.wheel(0, -randomInt(80, 240));
      await humanDelay(200, 500);
    }
  } catch {
    /* page may not allow wheel — ignore */
  }
}

// Smooth mouse movement toward a target in small steps
async function humanMove(page, x, y) {
  const steps = randomInt(8, 20);
  await page.mouse.move(
    x + randomInt(-30, 30),
    y + randomInt(-30, 30),
    { steps }
  );
  await humanDelay(40, 120);
  await page.mouse.move(x + randomInt(-3, 3), y + randomInt(-3, 3), { steps: 4 });
  await humanDelay(30, 80);
}

// Move mouse to element center then click
async function humanClick(page, locator) {
  const el = typeof locator === 'string' ? page.locator(locator) : locator;
  const box = await el.boundingBox();
  if (!box) throw new Error('Element has no bounding box — may be hidden');

  const cx = box.x + box.width / 2 + randomInt(-4, 4);
  const cy = box.y + box.height / 2 + randomInt(-4, 4);

  await humanMove(page, cx, cy);
  await page.mouse.click(cx, cy);
  await humanDelay(100, 300);
}

// Type text character by character with random delays
async function humanType(page, locator, text) {
  const el = typeof locator === 'string' ? page.locator(locator) : locator;
  await humanClick(page, el);
  await el.fill(''); // clear first
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(60, 180) });
  }
  await humanDelay(200, 500);
}

// Randomised but realistic viewport from common screen sizes
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

function randomViewport() {
  return VIEWPORTS[randomInt(0, VIEWPORTS.length - 1)];
}

// Stealth init script. Prefer the shared, hardened version from the Server relay
// module (single source of truth); fall back to a compact local copy if that
// path isn't reachable (e.g. Scraper running standalone).
let STEALTH_INIT;
try {
  const serverRoot = process.env.OREWIRE_SERVER_PATH || path.resolve(__dirname, '../../..');
  ({ STEALTH_INIT } = require(path.join(serverRoot, 'relay/stealth')));
} catch {
  STEALTH_INIT = `
    (() => {
      const def = (o, p, g) => { try { Object.defineProperty(o, p, { get: g, configurable: true }); } catch (e) {} };
      def(navigator, 'webdriver', () => undefined);
      if (!window.chrome) window.chrome = {};
      window.chrome.runtime = window.chrome.runtime || {};
      def(navigator, 'languages', () => ['en-US', 'en']);
      def(navigator, 'hardwareConcurrency', () => 8);
      def(navigator, 'deviceMemory', () => 8);
      for (const k of Object.keys(window)) { if (/^cdc_/.test(k)) { try { delete window[k]; } catch (e) {} } }
    })();
  `;
}

module.exports = {
  randomInt,
  humanDelay,
  humanReadPause,
  humanScroll,
  humanMove,
  humanClick,
  humanType,
  randomViewport,
  STEALTH_INIT,
};
