/**
 * Stealth — deliberately almost empty. Read this before adding anything back.
 *
 * This module used to inject a large init script that redefined
 * navigator.webdriver, navigator.plugins, window.chrome, WebGL vendor strings
 * and permissions, plus a CDP override that claimed the browser was Windows
 * Chrome. Measured against a real wall, every one of those made the browser
 * MORE identifiable, not less:
 *
 *   - `Object.defineProperty(navigator, 'webdriver', …)` leaves an own property
 *     on the instance. Real Chrome inherits `webdriver` from Navigator.prototype
 *     and nothing shadows it, so `hasOwnProperty('webdriver') === true` is a
 *     signal that exists only on patched browsers.
 *   - The faked plugin list was a plain Array, so
 *     `Object.prototype.toString.call(navigator.plugins)` returned
 *     `[object Array]`. No browser on earth reports that; real Chrome reports
 *     `[object PluginArray]`. This one tell is enough on its own.
 *   - The patched `WebGLRenderingContext.prototype.getParameter` no longer
 *     stringifies to `[native code]`, and it claimed a Direct3D11 renderer on a
 *     Linux host.
 *   - `applyStealthIdentity()` pinned a Windows UA and Windows client hints on a
 *     Linux machine, while fonts, WebGL and the rest stayed Linux. SEDAR+'s
 *     block page echoed the pinned UA straight back in its `sst=` parameter.
 *
 * The replacement is not a better init script — it is not needing one:
 * `patchright` + real Google Chrome + headed + a persistent profile reports
 * these values natively and correctly (see relay/engines/chromium.js). Verify
 * with `npm run relay:test-stealth`, which asserts each of the above.
 *
 * Set RELAY_LEGACY_STEALTH=true to restore the old script. It is kept only so
 * the difference can be measured, not because it is ever the right choice.
 */

// Realistic desktop window sizes. Harmless and still useful — a pool where every
// worker shares one viewport is a single fingerprint wearing several IPs.
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

const LEGACY_STEALTH_INIT = `
(() => {
  const def = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (e) {}
  };
  def(navigator, 'webdriver', () => undefined);
  if (!window.chrome) window.chrome = {};
  window.chrome.runtime = window.chrome.runtime || {};
  def(navigator, 'languages', () => ['en-US', 'en']);
  def(navigator, 'hardwareConcurrency', () => 8);
  def(navigator, 'deviceMemory', () => 8);
  for (const k of Object.keys(window)) {
    if (/^cdc_/.test(k)) { try { delete window[k]; } catch (e) {} }
  }
})();
`;

const NOOP_INIT = '/* relay stealth: intentionally empty — see relay/stealth.js */';

function legacyEnabled() {
  return process.env.RELAY_LEGACY_STEALTH === 'true';
}

/**
 * Injected by callers that still do `context.addInitScript(STEALTH_INIT)`.
 * A no-op unless the legacy script is explicitly re-enabled.
 */
const STEALTH_INIT = legacyEnabled() ? LEGACY_STEALTH_INIT : NOOP_INIT;

/**
 * No-op kept for call-site compatibility. Returns the browser's real UA so
 * callers that stored the result keep working — the point is that we no longer
 * override anything.
 */
async function applyStealthIdentity(cdp, browser) {
  if (!legacyEnabled()) {
    try { return browser?.version?.() || null; } catch { return null; }
  }
  // Legacy path retained purely for A/B measurement; see the header.
  let fullVersion = '124.0.0.0';
  try { fullVersion = browser.version() || fullVersion; } catch { /* ignore */ }
  const major = String(fullVersion.split('.')[0] || '124');
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  try {
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
    });
  } catch { /* ignore */ }
  return ua;
}

module.exports = {
  STEALTH_INIT,
  LEGACY_STEALTH_INIT,
  applyStealthIdentity,
  randomViewport,
  VIEWPORTS,
  legacyEnabled,
};
