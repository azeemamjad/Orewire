// Short TTL — the minute poller refreshes the snapshot; this just absorbs
// concurrent page loads between polls so we don't stampede the DB/TV.
const MOVERS_CACHE_TTL_MS = Math.max(
  5_000,
  parseInt(process.env.MOVERS_CACHE_TTL_MS || String(45 * 1000), 10) || 45_000,
);
const moversCache = new Map();

function getMoversCached(key) {
  const entry = moversCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > MOVERS_CACHE_TTL_MS) {
    moversCache.delete(key);
    return null;
  }
  return entry.data;
}

function setMoversCached(key, data) {
  moversCache.set(key, { ts: Date.now(), data });
}

function clearMoversCache() {
  moversCache.clear();
}

module.exports = {
  getMoversCached,
  setMoversCached,
  clearMoversCache,
  MOVERS_CACHE_TTL_MS,
};
