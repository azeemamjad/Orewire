const fs = require('fs');

function isDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/** Headed Chromium needs a display — force headless in Docker / headless servers. */
function resolveRelayHeadless() {
  if (process.env.RELAY_HEADLESS === 'true') return true;
  if (process.env.RELAY_HEADLESS === 'false') {
    const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    if (!hasDisplay) {
      if (isDocker()) {
        console.warn('[Relay] RELAY_HEADLESS=false ignored in Docker — using headless');
      } else {
        console.warn('[Relay] RELAY_HEADLESS=false but no DISPLAY — using headless');
      }
      return true;
    }
    return false;
  }
  return true;
}

module.exports = { isDocker, resolveRelayHeadless };
