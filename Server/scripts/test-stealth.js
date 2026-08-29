#!/usr/bin/env node
/**
 * Measure what the relay browser actually looks like, and whether a real target
 * lets it in. Run this instead of guessing.
 *
 *   node scripts/test-stealth.js                        # local fingerprint audit
 *   node scripts/test-stealth.js --url https://www.sedarplus.ca/home/
 *   RELAY_ENGINE=camoufox node scripts/test-stealth.js --url ...
 *   node scripts/test-stealth.js --proxy res            # through a DB residential proxy
 *
 * Exit code is non-zero if the target blocked us, so it can gate a deploy.
 */
require('dotenv').config();

const { launchSession, describeEngine, profileDirFor } = require('../relay/engines');
const { resolveRelayHeadless } = require('../relay/env');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const PASS = '\x1b[32m PASS \x1b[0m';
const FAIL = '\x1b[31m FAIL \x1b[0m';
const WARN = '\x1b[33m WARN \x1b[0m';

let failures = 0;
function check(ok, label, detail) {
  if (ok === 'warn') {
    console.log(`${WARN} ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  if (!ok) failures += 1;
  console.log(`${ok ? PASS : FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Everything here runs in the page. These are the exact signals a commercial
 * wall scores — and several of them are things our old init script was getting
 * *wrong* in a way that made the browser more identifiable, not less.
 */
const PROBE = () => {
  const out = {};
  const nav = navigator;

  out.webdriver = nav.webdriver;
  out.webdriverOwnProp = Object.prototype.hasOwnProperty.call(nav, 'webdriver');

  out.pluginsTag = Object.prototype.toString.call(nav.plugins);
  out.pluginsLen = nav.plugins.length;
  out.pluginsIsRealArray = nav.plugins instanceof PluginArray;
  out.mimeTag = Object.prototype.toString.call(nav.mimeTypes);

  out.hasChrome = typeof window.chrome === 'object' && window.chrome !== null;
  out.hasChromeRuntime = !!(window.chrome && window.chrome.runtime);

  out.ua = nav.userAgent;
  out.platform = nav.platform;
  out.uaDataPlatform = nav.userAgentData ? nav.userAgentData.platform : null;
  out.uaDataBrands = nav.userAgentData
    ? nav.userAgentData.brands.map((b) => `${b.brand}/${b.version}`)
    : null;

  out.languages = Array.from(nav.languages || []);
  out.hardwareConcurrency = nav.hardwareConcurrency;
  out.deviceMemory = nav.deviceMemory;

  out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  out.locale = Intl.DateTimeFormat().resolvedOptions().locale;

  out.innerWidth = window.innerWidth;
  out.outerWidth = window.outerWidth;
  out.innerHeight = window.innerHeight;
  out.outerHeight = window.outerHeight;
  out.screenW = screen.width;
  out.screenH = screen.height;

  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    // Availability first: on a GPU-less container Chrome 126+ returns null here,
    // and "no WebGL" is a stronger signal than any renderer string.
    out.webglAvailable = !!gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.webglVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
      out.webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
      out.webglExtCount = (gl.getSupportedExtensions() || []).length;
      // A patched getParameter stops being "[native code]" — walls check this.
      const proto = Object.getPrototypeOf(gl);
      out.getParameterNative = /\[native code\]/.test(
        Function.prototype.toString.call(proto.getParameter),
      );
    }
  } catch (e) {
    out.webglError = String(e);
  }

  // A hand-patched navigator getter is visible from its own toString.
  try {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    out.webdriverGetterNative = d && d.get
      ? /\[native code\]/.test(Function.prototype.toString.call(d.get))
      : null;
  } catch (e) {
    out.webdriverGetterNative = null;
  }

  return out;
};


/**
 * The SEDAR+ landing page serves almost anyone — the Radware/PerfDrive scoring
 * bites on the *search* flow, which is the request path the scraper actually
 * needs. Walking home -> Search SEDAR+ -> Documents -> profile-name input is
 * therefore the only test that means anything.
 */
async function runSedarFlow(page) {
  const { detectCaptchaOnPage } = require('../relay/captcha');
  const steps = [];
  const record = async (label, fn) => {
    try {
      await fn();
      const walled = await detectCaptchaOnPage(page);
      steps.push({ label, ok: !walled, url: page.url(), walled });
      return !walled;
    } catch (err) {
      steps.push({ label, ok: false, url: page.url(), error: err.message });
      return false;
    }
  };

  const pause = (a, b) => page.waitForTimeout(a + Math.floor(Math.random() * (b - a)));

  let ok = await record('load home', async () => {
    await page.goto('https://www.sedarplus.ca/home/', { waitUntil: 'load', timeout: 90000 });
    await pause(800, 1500);
  });

  if (ok) {
    ok = await record('click "Search SEDAR+"', async () => {
      const link = page.getByRole('link', { name: /search sedar/i }).first();
      await link.waitFor({ state: 'visible', timeout: 20000 });
      await link.click();
      await pause(600, 1200);
    });
  }

  if (ok) {
    ok = await record('click "Documents"', async () => {
      const link = page.getByRole('link', { name: /^documents$/i }).first();
      await link.waitFor({ state: 'visible', timeout: 20000 });
      await link.click();
      await pause(600, 1200);
    });
  }

  if (ok) {
    ok = await record('search form renders', async () => {
      await page.waitForSelector('input[placeholder="Profile name or number"]', {
        state: 'visible', timeout: 40000,
      });
    });
  }

  return steps;
}

(async () => {
  const engineInfo = describeEngine();
  console.log('\n=== Engine ===');
  console.log(JSON.stringify(engineInfo, null, 2));

  const proxyTier = arg('proxy');
  let proxy = null;
  if (proxyTier) {
    const store = require('../relay/proxy-store');
    await store.refreshProxyCache();
    const tier = proxyTier === true ? 'res' : String(proxyTier);
    const rows = store.getProxiesForRelayTier(tier === 'residential' ? 'res' : tier);
    if (!rows.length) {
      console.error(`No enabled '${tier}' proxies in the DB — running direct.`);
    } else {
      proxy = store.rowToPlaywrightProxy(rows[0]);
      console.log(`Proxy: ${proxy.server} (${rows[0].name || tier})`);
    }
  }

  const headless = arg('headless') ? true : resolveRelayHeadless();
  console.log(`Headless: ${headless}${headless ? '  <-- headed under Xvfb is strongly preferred' : ''}`);

  const session = await launchSession({
    workerId: arg('worker', 'stealth-test'),
    proxy,
    headless,
  });
  console.log(`Profile: ${session.profileDir}`);
  if (session.geo) console.log(`Geo: ${JSON.stringify(session.geo)}`);

  const { page } = session;
  let exitIp = null;

  try {
    // --- What does the outside world see us as? ---
    try {
      await page.goto('http://ip-api.com/json/?fields=status,countryCode,timezone,query', {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      const raw = await page.evaluate(() => document.body.innerText);
      exitIp = JSON.parse(raw);
      console.log(`\n=== Exit IP ===\n${exitIp.query}  ${exitIp.countryCode}  ${exitIp.timezone}`);
    } catch (e) {
      console.log(`\n=== Exit IP === (lookup failed: ${e.message})`);
    }

    // --- Fingerprint audit ---
    // Must be a secure context: navigator.userAgentData is undefined on
    // about:blank, which would silently skip the UA-vs-client-hints checks.
    const probeUrl = process.env.STEALTH_PROBE_URL || 'https://example.com/';
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const fp = await page.evaluate(PROBE);

    console.log('\n=== Fingerprint ===');
    check(fp.webdriver === false || fp.webdriver === undefined,
      'navigator.webdriver', String(fp.webdriver));
    check(!fp.webdriverOwnProp,
      'webdriver not shadowed on the instance',
      fp.webdriverOwnProp ? 'own property present — a patch is visible' : 'inherited from prototype');
    if (fp.webdriverGetterNative !== null) {
      check(fp.webdriverGetterNative, 'webdriver getter is native code');
    }
    check(fp.pluginsTag === '[object PluginArray]',
      'navigator.plugins is a real PluginArray', fp.pluginsTag);
    check(fp.pluginsLen > 0 || engineInfo.engine === 'camoufox',
      'navigator.plugins populated', `${fp.pluginsLen} plugins`);
    check(fp.hasChrome || engineInfo.engine === 'camoufox',
      'window.chrome present', String(fp.hasChrome));
    check(!/HeadlessChrome/i.test(fp.ua), 'UA has no HeadlessChrome token');
    check(fp.webglAvailable, 'WebGL is available',
      fp.webglAvailable
        ? `${fp.webglExtCount} extensions`
        : 'NO WebGL context — on a GPU-less host pass --enable-unsafe-swiftshader');
    check(fp.getParameterNative !== false,
      'WebGL getParameter is native code',
      fp.getParameterNative === false ? 'PATCHED — this is itself a bot signal' : 'native');
    if (fp.webglAvailable && /swiftshader|llvmpipe|software/i.test(String(fp.webglRenderer))) {
      check('warn', 'WebGL renderer is software',
        `${fp.webglRenderer} — plausible on a VPS, but a real GPU fingerprints better`);
    }
    check(fp.outerWidth > 0 && fp.outerHeight > 0,
      'window.outer* non-zero', `${fp.outerWidth}x${fp.outerHeight}`);
    check(fp.innerWidth <= fp.screenW && fp.innerHeight <= fp.screenH,
      'viewport fits the screen', `${fp.innerWidth}x${fp.innerHeight} in ${fp.screenW}x${fp.screenH}`);

    // The mismatch that hardcoded TIMEZONE creates.
    if (exitIp?.timezone) {
      check(fp.timezone === exitIp.timezone,
        'timezone matches exit IP',
        `browser=${fp.timezone} exit=${exitIp.timezone}`);
    } else {
      check('warn', 'timezone vs exit IP', `browser=${fp.timezone} (exit unknown)`);
    }

    // UA vs client hints — the exact contradiction SEDAR+ echoes back.
    if (fp.uaDataBrands) {
      const uaVersion = (fp.ua.match(/Chrome\/(\d+)/) || [])[1];
      const chBrand = fp.uaDataBrands.find((b) => /Google Chrome/i.test(b));
      const chVersion = chBrand ? chBrand.split('/')[1] : null;
      check(!uaVersion || !chVersion || uaVersion === chVersion,
        'UA version matches sec-ch-ua', `ua=${uaVersion} ch=${chVersion}`);
      const uaSaysWindows = /Windows NT/.test(fp.ua);
      check(!uaSaysWindows || fp.uaDataPlatform === 'Windows',
        'UA platform matches userAgentData.platform',
        `ua=${uaSaysWindows ? 'Windows' : 'other'} uaData=${fp.uaDataPlatform}`);
    }

    console.log('\n--- raw ---');
    console.log(JSON.stringify({
      ua: fp.ua,
      platform: fp.platform,
      uaDataPlatform: fp.uaDataPlatform,
      languages: fp.languages,
      timezone: fp.timezone,
      locale: fp.locale,
      webgl: `${fp.webglVendor} | ${fp.webglRenderer}`,
      window: `${fp.innerWidth}x${fp.innerHeight} (outer ${fp.outerWidth}x${fp.outerHeight}, screen ${fp.screenW}x${fp.screenH})`,
      hardwareConcurrency: fp.hardwareConcurrency,
      deviceMemory: fp.deviceMemory,
    }, null, 2));

    // --- SEDAR+ search flow (the request path that actually gets scored) ---
    if (arg('flow') === 'sedar') {
      console.log('\n=== SEDAR+ search flow ===');
      const steps = await runSedarFlow(page);
      for (const s of steps) {
        check(s.ok, s.label, s.error ? s.error : (s.walled ? `BOT WALL at ${s.url}` : s.url));
      }
      const shot = `/tmp/stealth-sedar-${Date.now()}.png`;
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`screenshot: ${shot}`);
    }

    // --- Live target ---
    const url = arg('url');
    if (url && url !== true) {
      console.log(`\n=== Live target: ${url} ===`);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(3000);
      const status = resp ? resp.status() : 0;
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();

      const { detectCaptchaOnPage } = require('../relay/captcha');
      const walled = await detectCaptchaOnPage(page);

      console.log(`HTTP ${status}  title="${title}"`);
      if (finalUrl !== url) console.log(`redirected -> ${finalUrl}`);

      const shot = `/tmp/stealth-${Date.now()}.png`;
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`screenshot: ${shot}`);

      check(status > 0 && status < 400, `target returned ${status}`);
      check(!walled, 'no bot wall / captcha detected');
    }
  } finally {
    await session.context.close().catch(() => {});
  }

  console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed\x1b[0m' : `\x1b[31m${failures} check(s) failed\x1b[0m`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(2);
});
