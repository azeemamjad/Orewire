/**
 * Why a browser "just disconnects".
 *
 * A headed Chrome that starts and then dies seconds later is almost always the
 * container running out of something, not a bug in the launch options. The two
 * that bite in practice:
 *
 *   - RAM. Each worker is a full Chrome with its own persistent profile. Three
 *     of them on a small VPS is enough to get the OOM killer involved, and the
 *     only trace is a context that closed.
 *   - /dev/shm. Docker gives a container 64MB by default; Chrome wants far more
 *     for its renderers. We pass --disable-dev-shm-usage to route around it, but
 *     if that flag is ever lost the symptom is exactly this.
 *
 * Neither shows up in the relay's error message, so log them at pool start where
 * they can be read in the deploy log.
 */
const fs = require('fs');
const os = require('os');


function shmBytes() {
  // statfs rather than shelling out to df: BusyBox's df has no --output, so the
  // shell version silently returned null on Alpine-based images.
  try {
    const st = fs.statfsSync('/dev/shm');
    return st.bsize * st.blocks;
  } catch {
    return null;
  }
}

/** cgroup v2 then v1 — os.totalmem() reports the HOST's RAM, not the container limit. */
function containerMemoryLimit() {
  const candidates = [
    '/sys/fs/cgroup/memory.max',                    // v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',  // v1
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw === 'max') return null;
      const n = parseInt(raw, 10);
      // v1 reports an absurd sentinel when unlimited.
      if (Number.isFinite(n) && n > 0 && n < Number.MAX_SAFE_INTEGER / 2) return n;
    } catch { /* not present */ }
  }
  return null;
}

function containerMemoryUsed() {
  for (const p of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try {
      const n = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (Number.isFinite(n)) return n;
    } catch { /* not present */ }
  }
  return null;
}

const MB = (n) => (n == null ? 'unknown' : `${Math.round(n / 1048576)} MB`);

/**
 * @param {number} workerCount how many browsers are about to be launched
 * @returns {object} the measured figures, for logging or an API
 */
function reportResources(workerCount) {
  const limit = containerMemoryLimit();
  const used = containerMemoryUsed();
  const shm = shmBytes();
  const available = limit != null && used != null ? limit - used : null;
  // A headed Chrome with a warm profile sits around 300-400MB; budget 400.
  const needed = workerCount * 400 * 1048576;

  const info = {
    workers: workerCount,
    memoryLimit: limit,
    memoryUsed: used,
    memoryAvailable: available,
    shm,
    estimatedNeed: needed,
    hostTotal: os.totalmem(),
  };

  console.log(
    `[Relay] Resources — memory ${limit == null ? `host ${MB(os.totalmem())} (no container limit)` : `${MB(used)} / ${MB(limit)}`}`
    + `, /dev/shm ${MB(shm)}, launching ${workerCount} browser(s) (~${MB(needed)} needed)`,
  );

  if (shm != null && shm < 256 * 1048576) {
    console.warn(
      `[Relay] /dev/shm is only ${MB(shm)}. Chrome is launched with --disable-dev-shm-usage so this`
      + ' should be survivable, but raising it to 1GB removes a whole class of renderer crashes.',
    );
  }
  if (available != null && available < needed) {
    console.warn(
      `[Relay] WARNING: about ${MB(available)} of memory is available but ~${MB(needed)} is needed for`
      + ` ${workerCount} headed browsers. Expect workers to die with "browser disconnected" as the`
      + ' OOM killer takes them. Either raise the container memory limit, or reduce the pool by'
      + ' disabling proxies in Admin -> Proxies (each enabled proxy is one browser).',
    );
  }
  return info;
}

module.exports = { reportResources, containerMemoryLimit, containerMemoryUsed, shmBytes };
