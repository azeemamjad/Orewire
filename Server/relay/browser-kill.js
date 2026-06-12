const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Force-kill the Playwright Chromium OS process (and best-effort children on Linux).
 * browser.close() alone is not enough when the process crashed or hung.
 */
async function forceKillBrowser(browser, knownPid = null) {
  let pid = knownPid;
  try {
    if (!pid && browser) pid = browser.process()?.pid;
  } catch {
    /* ignore */
  }

  try {
    if (browser?.isConnected?.()) {
      await Promise.race([
        browser.close(),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
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

  // Chromium often leaves renderer/gpu children behind after a hard crash.
  if (process.platform === 'linux') {
    try {
      await execFileAsync('pkill', ['-KILL', '-P', String(pid)]);
    } catch {
      /* no children or pkill unavailable */
    }
  }
}

module.exports = { forceKillBrowser };
