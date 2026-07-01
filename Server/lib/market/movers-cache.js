const MOVERS_CACHE_TTL_MS = 30 * 60 * 1000;
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
};
