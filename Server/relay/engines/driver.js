/**
 * Which Playwright build the relay drives.
 *
 * Vanilla Playwright is detectable *before* any of our own code runs: it calls
 * CDP `Runtime.enable` to create its isolated world, and walls like Radware /
 * ShieldSquare probe for exactly that. No init script can hide it, because the
 * leak is in the driver, not in the page.
 *
 * `patchright` is a drop-in Playwright fork that removes that leak (plus the
 * Console.enable leak, the automation command flags, and the main-world script
 * injection). Same API, same version line — so it is a straight swap.
 *
 * If patchright is missing we still run, but loudly: a relay on vanilla
 * Playwright will keep getting 403s on protected sites and the operator should
 * know why.
 */

let _driver = null;
let _warned = false;

function loadDriver() {
  if (_driver) return _driver;

  if (process.env.RELAY_DRIVER === 'playwright') {
    _driver = { mod: require('playwright'), name: 'playwright', patched: false };
    return _driver;
  }

  try {
    _driver = { mod: require('patchright'), name: 'patchright', patched: true };
  } catch {
    if (!_warned) {
      _warned = true;
      console.warn(
        '[Relay] patchright not installed — falling back to vanilla playwright. '
        + 'The Runtime.enable CDP leak is present and bot walls (SEDAR+/Radware) will block this browser. '
        + 'Fix with: npm i patchright && npx patchright install chromium',
      );
    }
    _driver = { mod: require('playwright'), name: 'playwright', patched: false };
  }
  return _driver;
}

/** The driver's chromium namespace (patched when available). */
function getChromium() {
  return loadDriver().mod.chromium;
}

/** Firefox namespace — used by the Camoufox engine. */
function getFirefox() {
  return loadDriver().mod.firefox;
}

function driverName() {
  return loadDriver().name;
}

function isPatched() {
  return loadDriver().patched;
}

module.exports = { getChromium, getFirefox, driverName, isPatched };
