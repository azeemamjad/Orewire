/**
 * Chromium engine — real Google Chrome, driven by patchright, in a persistent
 * profile.
 *
 * Every choice here is the opposite of what the old relay did, on purpose:
 *
 *   channel: 'chrome'        Bundled Chromium advertises `HeadlessChrome` in its
 *                            sec-ch-ua and ships a different codec/font set. The
 *                            Radware wall on SEDAR+ 403s that at the header layer,
 *                            before a single line of page JS runs.
 *   headless: false          Headless Chrome differs from headed in ways no init
 *                            script reaches (GPU pipeline, window.outerHeight,
 *                            missing renderer processes). Run it headed under
 *                            Xvfb instead — see start-headed.sh.
 *   launchPersistentContext  A fresh incognito-shaped context every run is itself
 *                            a signal, and patchright is only fully patched on
 *                            the persistent path. A real profile also carries
 *                            cookies/prefs forward between runs.
 *   viewport: null           Let the OS window define the viewport. A Playwright
 *                            viewport override desynchronises innerWidth from
 *                            outerWidth/screen — a classic headless tell.
 *   no userAgent override    Overriding the UA leaves navigator.userAgent
 *                            claiming one Chrome build while sec-ch-ua reports
 *                            the real one. That mismatch is what SEDAR+'s block
 *                            page echoes back in its `sst=` parameter.
 *   minimal args             `--disable-blink-features=AutomationControlled` and
 *                            friends are fingerprintable in their own right, and
 *                            patchright already strips the automation switches.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getChromium, driverName } = require('./driver');
const { resolveGeoForProxy } = require('../geo');

const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

let _channelChecked = false;
let _channel = null;

/**
 * Prefer real Chrome; fall back to the patched Chromium if it isn't installed
 * (and say so — on a protected target that fallback is the difference between
 * data and a 403).
 */
function resolveChannel() {
  if (_channelChecked) return _channel;
  _channelChecked = true;

  const configured = process.env.BROWSER_CHANNEL;
  if (configured === 'chromium') {
    _channel = null;
    return _channel;
  }
  if (configured) {
    _channel = configured;
    return _channel;
  }

  if (CHROME_PATHS.some((p) => { try { return fs.existsSync(p); } catch { return false; } })) {
    _channel = 'chrome';
  } else {
    _channel = null;
    console.warn(
      '[Relay] Google Chrome not found — falling back to the patched Chromium. '
      + 'Bot walls that score sec-ch-ua (SEDAR+/Radware) will block it, and the '
      + 'Docker image does not ship that build by default, so launching will fail '
      + "with \"Executable doesn't exist at /ms-playwright/chromium_headless_shell-…\". "
      + 'Fix with `npx patchright install chrome` (preferred), or rebuild the image '
      + 'with --build-arg INSTALL_PATCHED_CHROMIUM=1.',
    );
  }
  return _channel;
}

/**
 * Chrome 126+ stopped silently falling back to SwiftShader when there is no GPU:
 * on a GPU-less container `canvas.getContext('webgl')` returns **null** outright.
 * A browser with no WebGL at all is a far louder bot signal than one rendering
 * in software, so allow the software path when there is no DRI device.
 *
 * On a host with a real GPU this flag changes nothing — Chrome still uses
 * hardware and reports the true renderer.
 */
function needsSoftwareGl() {
  if (process.env.RELAY_SWIFTSHADER === 'false') return false;
  if (process.env.RELAY_SWIFTSHADER === 'true') return true;
  try {
    return !fs.existsSync('/dev/dri');
  } catch {
    return true;
  }
}

function needsNoSandbox() {
  if (process.env.RELAY_NO_SANDBOX === 'false') return false;
  if (process.env.RELAY_NO_SANDBOX === 'true') return true;
  // Chrome's sandbox cannot start as uid 0 without user namespaces, which is the
  // normal situation inside our container.
  try {
    return process.getuid?.() === 0 || fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * A persistent context has no `browser()` handle, so Playwright never exposes
 * the child process. Recover the pid from the profile path instead — the relay
 * needs it to hard-kill zombie renderers.
 */
async function findPidByProfile(profileDir) {
  if (process.platform !== 'linux') return null;
  const needle = `--user-data-dir=${profileDir}`;
  try {
    // Read /proc directly rather than shelling out to pgrep: the search pattern
    // starts with `--`, which pgrep parses as its own option, and procps is not
    // guaranteed to exist in a slim container.
    const entries = await fsp.readdir('/proc');
    const candidates = [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      let cmdline;
      try {
        cmdline = await fsp.readFile(`/proc/${entry}/cmdline`, 'utf8');
      } catch {
        continue; // process exited, or not ours to read
      }
      if (!cmdline.includes(needle)) continue;
      // Renderer / GPU / zygote children all carry `--type=`; the browser
      // process is the one that does not. Killing that one takes the tree.
      if (cmdline.includes('--type=')) continue;
      candidates.push(parseInt(entry, 10));
    }
    return candidates.length ? Math.min(...candidates) : null;
  } catch {
    return null;
  }
}

/**
 * Remove a profile lock left behind by a container that no longer exists.
 *
 * Chrome writes `SingletonLock` (a symlink naming <hostname>-<pid>) into every
 * user-data-dir. Now that profiles live on a persistent volume, that lock
 * outlives the container that created it, and the next deploy gets a new
 * hostname — so Chrome decides the profile is "in use by another computer",
 * refuses to start, and launchPersistentContext hangs until it times out:
 *
 *   The profile appears to be in use by another Google Chrome process (1760)
 *   on another computer (a8c8bf737a80).
 *
 * Only clears the lock when no live process is actually holding the directory,
 * so a genuinely concurrent Chrome is never yanked out from under itself.
 */
async function clearStaleProfileLock(profileDir) {
  const live = await findPidByProfile(profileDir);
  if (live) return false;

  let cleared = false;
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const target = path.join(profileDir, name);
    try {
      // lstat, not stat: SingletonLock is a symlink and its target never exists,
      // so stat() would throw on exactly the file we need to remove.
      fs.lstatSync(target);
      fs.rmSync(target, { force: true });
      cleared = true;
    } catch {
      /* not present */
    }
  }
  if (cleared) {
    console.log(`[Relay] Cleared a stale Chrome profile lock in ${profileDir} (left by a previous container)`);
  }
  return cleared;
}

/** Real inner size of the window, since `viewport: null` makes Playwright report null. */
async function measureViewport(page, fallback) {
  try {
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    if (size?.width > 0 && size?.height > 0) return size;
  } catch { /* page not ready */ }
  return fallback;
}

/**
 * @param {object} opts
 * @param {string} opts.profileDir      persistent user-data-dir for this worker
 * @param {object|null} opts.proxy      { server, username, password }
 * @param {{width:number,height:number}} opts.window  desired OS window size
 * @param {boolean} opts.headless
 */
async function launch({ profileDir, proxy, window, headless }) {
  const chromium = getChromium();
  const channel = resolveChannel();
  const geo = await resolveGeoForProxy(proxy);

  fs.mkdirSync(profileDir, { recursive: true });
  await clearStaleProfileLock(profileDir);

  const args = [`--window-size=${window.width},${window.height}`];
  if (needsNoSandbox()) args.push('--no-sandbox');
  if (needsSoftwareGl()) args.push('--enable-unsafe-swiftshader');
  // Shared memory in containers defaults to 64MB; Chrome crashes without this.
  if (fs.existsSync('/.dockerenv')) args.push('--disable-dev-shm-usage');

  const contextOpts = {
    headless,
    args,
    viewport: null,
    acceptDownloads: true,
    locale: geo.locale,
    timezoneId: geo.timezoneId,
    // NO userAgent, NO extraHTTPHeaders, NO ignoreDefaultArgs: patchright owns
    // the automation surface and anything we add here only desynchronises it.
  };
  if (channel) contextOpts.channel = channel;
  if (proxy?.server) {
    contextOpts.proxy = { server: proxy.server };
    if (proxy.username) contextOpts.proxy.username = proxy.username;
    if (proxy.password) contextOpts.proxy.password = proxy.password;
  }

  const context = await chromium.launchPersistentContext(profileDir, contextOpts);
  const page = context.pages()[0] || (await context.newPage());
  const cdp = await context.newCDPSession(page);
  const viewport = await measureViewport(page, window);
  const pid = await findPidByProfile(profileDir);

  return {
    engine: 'chrome',
    driver: driverName(),
    channel: channel || 'chromium(bundled)',
    context,
    page,
    cdp,
    browser: null,
    pid,
    profileDir,
    viewport,
    geo,
    supportsCdp: true,
    headless,
  };
}

module.exports = { launch, resolveChannel, findPidByProfile, clearStaleProfileLock };
