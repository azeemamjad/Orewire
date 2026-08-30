/**
 * Is a path on a real volume, or on the container's writable layer?
 *
 * This matters because the failure is silent and delayed: writes succeed, the
 * app looks healthy, and everything vanishes on the next deploy. That has
 * already cost one tunnel key, one download ledger and a set of browser
 * profiles — which between them mean re-pasting credentials and re-downloading
 * a month of filings.
 */
const fs = require('fs');
const path = require('path');

/**
 * @returns {boolean|null} true = on a volume, false = writable layer,
 *                         null = cannot tell (not Linux / no procfs)
 */
function isPathPersisted(target) {
  try {
    const info = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    const mounts = new Set(
      info.split('\n').map((line) => line.split(' ')[4]).filter(Boolean),
    );
    // Walk up to the nearest enclosing mount. "/" is the container's own root
    // filesystem, so anything that resolves there is not persisted.
    let dir = path.resolve(target);
    for (;;) {
      if (mounts.has(dir)) return dir !== '/';
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  } catch {
    return null;
  }
}

/** Loud, once, at boot — this is the kind of thing nobody notices until a deploy. */
function warnIfDataNotPersisted(dataDir) {
  const persisted = isPathPersisted(dataDir);
  if (persisted !== false) return persisted;
  console.warn('');
  console.warn('  ############################################################');
  console.warn(`  #  WARNING: ${dataDir} is NOT on a persistent volume.`);
  console.warn('  #');
  console.warn('  #  Everything under it is in the container writable layer and');
  console.warn('  #  will be LOST on the next deploy:');
  console.warn('  #    - the home-tunnel SSH key (Admin -> Proxies)');
  console.warn('  #    - the download ledger (re-downloads every filing again)');
  console.warn('  #    - browser profiles (cache + session cookies)');
  console.warn('  #    - staged PDFs in data/downloads');
  console.warn('  #');
  console.warn('  #  Mount a volume at /app/data in Dokploy and redeploy.');
  console.warn('  ############################################################');
  console.warn('');
  return false;
}

module.exports = { isPathPersisted, warnIfDataNotPersisted };
