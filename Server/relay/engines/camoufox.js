/**
 * Camoufox engine — the escape hatch for when a Chromium stack keeps losing.
 *
 * Camoufox is a *patched Firefox build*: the anti-fingerprint work happens
 * inside the C++ engine, so there is no JS shim for a wall to catch reaching
 * back through. Different engine family means a completely different set of
 * tells — a wall tuned to score Chromium automation has far less to grip.
 *
 * Trade-offs the caller must know about:
 *   - Firefox speaks Juggler, not CDP. No screencast, no Input.dispatch*. The
 *     relay viewer falls back to screenshot polling (see relay/screen.js).
 *   - It is slower than Chrome. The user explicitly accepted slower scraping.
 *   - The browser binary is a separate ~200MB download:
 *       npm run relay:fetch-camoufox
 *
 * Version pinning matters: camoufox-js declares `playwright-core <1.61.0`
 * because the Camoufox build ships a Juggler protocol matching that line. We
 * deliberately require `playwright-core` here rather than reusing patchright's
 * firefox namespace (1.62.x) — patchright only patches Chromium anyway, so
 * there is nothing to gain and a protocol mismatch to lose.
 */
const fs = require('fs');

let _camoufox = null;
let _firefox = null;

function loadCamoufox() {
  if (_camoufox) return _camoufox;
  try {
    _camoufox = require('camoufox-js');
  } catch {
    throw new Error(
      'RELAY_ENGINE=camoufox but camoufox-js is not installed. '
      + 'Run: npm i camoufox-js && npm run relay:fetch-camoufox',
    );
  }
  return _camoufox;
}

function loadFirefox() {
  if (_firefox) return _firefox;
  _firefox = require('playwright-core').firefox;
  return _firefox;
}

/**
 * Map an OreWire proxy row to what Camoufox wants. Camoufox takes the same
 * shape Playwright does, so this is mostly a null-guard — but routing it through
 * Camoufox (rather than Playwright's own proxy option) is what lets `geoip: true`
 * resolve the exit IP and align timezone/locale/lat-long with it.
 */
function toCamoufoxProxy(proxy) {
  if (!proxy?.server) return undefined;
  const out = { server: proxy.server };
  if (proxy.username) out.username = proxy.username;
  if (proxy.password) out.password = proxy.password;
  return out;
}

/**
 * Camoufox's `humanize` puts a bezier cursor path on *every* mouse move —
 * including the internal moves Playwright makes inside `locator.click()`, which
 * then has to re-run its actionability checks after each slow step. Combined
 * with the viewer's screenshot polling that was enough to push a plain click
 * past a 30s timeout.
 *
 * Our scrapers already pace themselves in lib/scraper/utils/human.js, so this
 * is off by default. Turn it on for a target that scores raw cursor telemetry.
 */
function resolveHumanize() {
  const v = (process.env.CAMOUFOX_HUMANIZE || '').trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  const seconds = Number(v);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : false;
}

function resolveOsSpoof() {
  const configured = (process.env.CAMOUFOX_OS || '').trim();
  if (configured) return configured.split(',').map((s) => s.trim()).filter(Boolean);
  // Match the host family by default. Claiming Windows from a Linux box is only
  // safe because Camoufox also swaps the font set and WebGL strings to match —
  // but leaving it as a list lets it vary per worker, which is better than every
  // worker in the pool sharing one identity.
  return ['windows', 'macos', 'linux'];
}

async function launch({ profileDir, proxy, window, headless }) {
  const { launchOptions } = loadCamoufox();
  const firefox = loadFirefox();

  fs.mkdirSync(profileDir, { recursive: true });

  const camoufoxProxy = toCamoufoxProxy(proxy);

  const opts = await launchOptions({
    headless,
    proxy: camoufoxProxy,
    os: resolveOsSpoof(),
    // Resolve timezone / locale / geolocation from the proxy's exit IP. This is
    // the same mismatch relay/geo.js fixes for Chrome, handled in-engine here.
    geoip: camoufoxProxy ? true : false,
    humanize: resolveHumanize(),
    window: [window.width, window.height],
    enable_cache: true,
  });

  const context = await firefox.launchPersistentContext(profileDir, {
    ...opts,
    // Camoufox pins the window to its spoofed dimensions; an explicit Playwright
    // viewport fights that and makes the page report the wrong size.
    viewport: null,
    acceptDownloads: true,
  });

  const page = context.pages()[0] || (await context.newPage());
  let viewport = window;
  let geo = { locale: null, timezoneId: null, source: 'camoufox-geoip' };
  try {
    const probed = await page.evaluate(() => {
      const opts = Intl.DateTimeFormat().resolvedOptions();
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        timeZone: opts.timeZone,
        locale: opts.locale,
      };
    });
    if (probed?.width > 0) viewport = { width: probed.width, height: probed.height };
    // Camoufox resolves locale/timezone itself (from geoip when proxied), so read
    // back what it actually applied rather than reporting nulls to the admin UI.
    geo = { locale: probed.locale, timezoneId: probed.timeZone, source: 'camoufox-geoip' };
  } catch { /* not ready */ }

  return {
    engine: 'camoufox',
    driver: 'playwright-core(firefox)',
    channel: 'camoufox',
    context,
    page,
    cdp: null,          // Firefox has no CDP — viewer degrades to screenshot polling
    browser: null,
    pid: null,
    profileDir,
    viewport,
    geo,
    supportsCdp: false,
    headless,
  };
}

module.exports = { launch };
