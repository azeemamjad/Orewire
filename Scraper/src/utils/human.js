function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(min = 300, max = 900) {
  await new Promise((r) => setTimeout(r, randomInt(min, max)));
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

// Inject scripts that remove common Playwright/CDP fingerprints
const STEALTH_INIT = `
  (() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Realistic plugin list
    Object.defineProperty(navigator, 'plugins', {
      get: () => ({
        length: 3,
        0: { name: 'Chrome PDF Plugin' },
        1: { name: 'Chrome PDF Viewer' },
        2: { name: 'Native Client' },
      }),
    });

    // Languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Remove CDP artefacts
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // Spoof hardware concurrency and memory to realistic values
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
  })();
`;

module.exports = { randomInt, humanDelay, humanMove, humanClick, humanType, randomViewport, STEALTH_INIT };
