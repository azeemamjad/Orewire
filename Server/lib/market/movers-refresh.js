/**
 * Shared movers snapshot: TradingView scanner refresh on a short interval.
 * All browsers read /api/market/movers → this cache (never hit TV directly).
 */
const { fetchTvMovers } = require('./tv-movers');
const { setMoversCached, clearMoversCache } = require('./movers-cache');

// Keep a hot snapshot for ALL:10 (home page) plus whatever keys we last served.
let _snapshot = null; // { updatedAt, byKey: Map }
let _running = false;
let _lastError = null;

function snapshotKey(exchange, limit) {
  return `${String(exchange || 'ALL').toUpperCase()}:${limit}`;
}

function getMoversSnapshot(exchange = 'ALL', limit = 10) {
  if (!_snapshot) return null;
  const key = snapshotKey(exchange, limit);
  const hit = _snapshot.byKey.get(key);
  if (hit) return hit;
  // Derive a sliced view from the ALL:50 master if present.
  const master = _snapshot.byKey.get(snapshotKey('ALL', 50));
  if (!master) return null;
  const ex = String(exchange || 'ALL').toUpperCase();
  const lim = Math.min(Math.max(1, limit), 50);
  let gainers = master.gainers;
  let losers = master.losers;
  if (ex !== 'ALL') {
    gainers = gainers.filter((g) => g.exchange === ex);
    losers = losers.filter((l) => l.exchange === ex);
  }
  return {
    exchange: ex,
    updatedAt: master.updatedAt,
    gainers: gainers.slice(0, lim),
    losers: losers.slice(0, lim),
    source: master.source || 'tradingview',
  };
}

function getMoversStatus() {
  return {
    running: _running,
    updatedAt: _snapshot?.updatedAt || null,
    lastError: _lastError,
    keys: _snapshot ? [..._snapshot.byKey.keys()] : [],
  };
}

async function refreshMoversSnapshot({ reason = 'manual' } = {}) {
  if (_running) return { ok: false, reason: 'already_running' };
  _running = true;
  try {
    // One wide ALL fetch covers home + exchange filters via slicing.
    const payload = await fetchTvMovers({ exchange: 'ALL', limit: 50 });
    const byKey = new Map();
    byKey.set(snapshotKey('ALL', 50), payload);
    // Pre-slice common limits for cache hits without recomputing.
    for (const lim of [5, 10, 20]) {
      byKey.set(snapshotKey('ALL', lim), {
        ...payload,
        gainers: payload.gainers.slice(0, lim),
        losers: payload.losers.slice(0, lim),
      });
    }
    for (const ex of ['TSX', 'TSXV', 'CSE', 'ASX']) {
      const g = payload.gainers.filter((x) => x.exchange === ex);
      const l = payload.losers.filter((x) => x.exchange === ex);
      for (const lim of [10, 20]) {
        byKey.set(snapshotKey(ex, lim), {
          exchange: ex,
          updatedAt: payload.updatedAt,
          gainers: g.slice(0, lim),
          losers: l.slice(0, lim),
          source: payload.source,
        });
      }
    }

    _snapshot = { updatedAt: payload.updatedAt, byKey };
    _lastError = null;
    clearMoversCache();
    // Warm the HTTP cache for the home-page key.
    setMoversCached('ALL:10', byKey.get('ALL:10'));
    console.log(
      `[movers] Refreshed (${reason}): ${payload.gainers.length} gainers / ${payload.losers.length} losers @ ${payload.updatedAt}`,
    );
    return { ok: true, payload: byKey.get('ALL:10') };
  } catch (err) {
    _lastError = err?.message || String(err);
    console.error('[movers] Refresh failed:', _lastError);
    return { ok: false, error: _lastError };
  } finally {
    _running = false;
  }
}

module.exports = {
  getMoversSnapshot,
  getMoversStatus,
  refreshMoversSnapshot,
};
