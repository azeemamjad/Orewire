/**
 * Stealth helpers for relay browsers — reduce the automation/headless
 * fingerprints that walls like PerfDrive/ShieldSquare (Imperva) score on.
 *
 * Two layers:
 *   1. STEALTH_INIT — an init script (runs before page scripts) that patches the
 *      JS-visible signals: navigator.webdriver, window.chrome, plugins, WebGL
 *      vendor/renderer, permissions, languages, hardware.
 *   2. applyStealthIdentity() — sets the UA + matching Client Hints via CDP, so
 *      the network-layer UA, navigator.userAgent, and Sec-CH-UA headers all
 *      agree and never leak "HeadlessChrome".
 */

// Realistic desktop viewports (kept in sync with how a real Chrome window looks).
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

const STEALTH_INIT = `
(() => {
  const def = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (e) {}
  };

  // 1. webdriver flag — headed Chrome has it undefined (not false).
  def(navigator, 'webdriver', () => undefined);

  // 2. window.chrome — present on real Chrome, absent in vanilla automation.
  if (!window.chrome) {
    window.chrome = {};
  }
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
  window.chrome.csi = window.chrome.csi || function () { return {}; };
  window.chrome.loadTimes = window.chrome.loadTimes || function () { return {}; };

  // 3. Languages.
  def(navigator, 'languages', () => ['en-US', 'en']);

  // 4. Plugins / mimeTypes — empty arrays are a headless tell. Build array-likes
  //    that report the standard Chrome PDF entries.
  const mkPlugin = (name, filename, desc) => {
    const p = { name, filename, description: desc, length: 1 };
    p[0] = { type: 'application/pdf', suffixes: 'pdf', description: desc, enabledPlugin: p };
    return p;
  };
  const pdf = mkPlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format');
  const pdfv = mkPlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', '');
  const nacl = mkPlugin('Native Client', 'internal-nacl-plugin', '');
  const plugins = [pdf, pdfv, nacl];
  plugins.item = (i) => plugins[i] || null;
  plugins.namedItem = (n) => plugins.find((p) => p.name === n) || null;
  plugins.refresh = () => {};
  def(navigator, 'plugins', () => plugins);

  // 5. permissions.query — headless returns 'denied' for notifications while
  //    Notification.permission is 'default'; align them.
  try {
    const orig = navigator.permissions && navigator.permissions.query;
    if (orig) {
      navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : orig.call(navigator.permissions, params);
    }
  } catch (e) {}

  // 6. WebGL vendor/renderer — SwiftShader/Google reveals headless. Report a
  //    common Intel GPU string instead.
  try {
    const patch = (proto) => {
      const getParam = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 37445) return 'Google Inc. (Intel)';                                  // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'; // UNMASKED_RENDERER_WEBGL
        return getParam.call(this, p);
      };
    };
    if (window.WebGLRenderingContext) patch(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patch(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // 7. Hardware.
  def(navigator, 'hardwareConcurrency', () => 8);
  def(navigator, 'deviceMemory', () => 8);

  // 8. Scrub Playwright/CDP artefacts.
  for (const k of Object.keys(window)) {
    if (/^cdc_/.test(k) || /\\$cdc_/.test(k)) { try { delete window[k]; } catch (e) {} }
  }
})();
`;

/**
 * Build a clean Windows-Chrome UA whose major version matches the actual
 * browser, and push it + matching Client Hints through CDP so headers,
 * navigator.userAgent and Sec-CH-UA all agree.
 * @returns {string} the UA that was applied (so callers can store it).
 */
async function applyStealthIdentity(cdp, browser, { userAgent } = {}) {
  let fullVersion = '124.0.0.0';
  try { fullVersion = browser.version() || fullVersion; } catch { /* ignore */ }
  const major = String(fullVersion.split('.')[0] || '124');
  const ua =
    userAgent ||
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

  try {
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: major },
          { brand: 'Google Chrome', version: major },
          { brand: 'Not.A/Brand', version: '24' },
        ],
        fullVersion,
        fullVersionList: [
          { brand: 'Chromium', version: fullVersion },
          { brand: 'Google Chrome', version: fullVersion },
          { brand: 'Not.A/Brand', version: '24.0.0.0' },
        ],
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
      },
    });
  } catch {
    /* CDP override unsupported — context userAgent still applies */
  }
  return ua;
}

module.exports = { STEALTH_INIT, applyStealthIdentity, randomViewport, VIEWPORTS };
