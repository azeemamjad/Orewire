const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const CLOSE_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
}

/**
 * Force-kill a relay browser's OS process (and its children on Linux).
 *
 * Closing is not enough when the process crashed or hung, and persistent
 * contexts make this fiddlier than it used to be: `launchPersistentContext`
 * returns a BrowserContext with no `browser()` handle, so there is no
 * `browser.process()` to read a pid from. The engine resolves the pid from the
 * profile path at launch and hands it here instead.
 *
 * @param {object} target
 * @param {import('playwright').Browser|null} [target.browser]
 * @param {import('playwright').BrowserContext|null} [target.context]
 * @param {number|null} [target.pid]
 */
async function forceKillBrowser(target, legacyPid = null) {
  // Tolerate the old positional call shape: forceKillBrowser(browser, pid).
  const { browser, context, pid: givenPid } = (target && (target.browser !== undefined || target.context !== undefined))
    ? target
    : { browser: target, context: null, pid: legacyPid };

  let pid = givenPid ?? legacyPid;
  try {
    if (!pid && browser) pid = browser.process()?.pid;
  } catch {
    /* ignore */
  }

  // Closing the context is what actually shuts a persistent profile down
  // cleanly — it flushes cookies and storage so the next run starts as a
  // returning visitor rather than a brand-new one.
  try {
    if (context) await withTimeout(context.close(), CLOSE_TIMEOUT_MS);
  } catch {
    /* ignore */
  }

  try {
    if (browser?.isConnected?.()) {
      await withTimeout(browser.close(), CLOSE_TIMEOUT_MS);
    }
  } catch {
    /* ignore */
  }

  if (!pid) return;

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already dead */
  }

  // Chrome often leaves renderer/gpu children behind after a hard crash.
  if (process.platform === 'linux') {
    try {
      await execFileAsync('pkill', ['-KILL', '-P', String(pid)]);
    } catch {
      /* no children or pkill unavailable */
    }
  }
}

module.exports = { forceKillBrowser };
