const fs = require('fs');

function isDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function hasDisplay() {
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Headed or headless?
 *
 * Headed is strongly preferred: headless Chrome differs from headed in ways no
 * init script can reach (GPU pipeline, window.outer* sizing, missing renderer
 * processes), and bot walls score exactly those. A headless server can still run
 * headed under a virtual display — see start-headed.sh, and the Dockerfile,
 * which both launch the app through `xvfb-run`.
 *
 * Default is therefore "headed if a display exists", not "headless". Set
 * RELAY_HEADLESS=true to force headless anyway.
 */
function resolveRelayHeadless() {
  if (process.env.RELAY_HEADLESS === 'true') return true;

  if (process.env.RELAY_HEADLESS === 'false') {
    if (!hasDisplay()) {
      console.warn(
        `[Relay] RELAY_HEADLESS=false but no DISPLAY${isDocker() ? ' (in Docker)' : ''} — `
        + 'using headless. Start the app via ./start-headed.sh so Xvfb provides one.',
      );
      return true;
    }
    return false;
  }

  // Unset: follow the display.
  if (hasDisplay()) return false;
  console.warn(
    '[Relay] No DISPLAY — running headless. Bot walls score headless Chrome heavily; '
    + 'launch via ./start-headed.sh (Xvfb) to run headed on a server with no monitor.',
  );
  return true;
}

module.exports = { isDocker, hasDisplay, resolveRelayHeadless };
