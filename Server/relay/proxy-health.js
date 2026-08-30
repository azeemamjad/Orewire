/**
 * Which proxies are currently usable.
 *
 * This exists because a browser launched with a *dead* proxy still starts
 * cleanly and looks healthy — the failure only surfaces as
 * ERR_TUNNEL_CONNECTION_FAILED on the first navigation. So proxy health cannot
 * be probed at acquire time; it has to be learned from task outcomes.
 *
 * That matters for the home-network setup: the home tunnel is primary and free,
 * Oxylabs is the paid fallback. We only want to spend money when the home link
 * is genuinely down — not when it is merely busy. So a proxy is taken out of
 * rotation only after repeated *transport* failures, and only for a cooldown,
 * after which it is tried again.
 *
 * State is per-process and in-memory on purpose: a restart should re-try
 * everything rather than inherit a stale verdict.
 */
const FAILURES_BEFORE_COOLDOWN = Math.max(
  1,
  parseInt(process.env.RELAY_PROXY_FAILURES_BEFORE_COOLDOWN || '3', 10),
);
const COOLDOWN_MS = Math.max(
  0,
  parseInt(process.env.RELAY_PROXY_COOLDOWN_MS || '600000', 10), // 10 minutes
);

/** @type {Map<string, { fails: number, cooldownUntil: number, lastError: string|null }>} */
const _health = new Map();

function entry(workerId) {
  let e = _health.get(workerId);
  if (!e) {
    e = { fails: 0, cooldownUntil: 0, lastError: null };
    _health.set(workerId, e);
  }
  return e;
}

/**
 * A task on this worker failed at the transport layer.
 * @returns {boolean} true if this failure just put the worker into cooldown
 */
function markTransportFailure(workerId, message) {
  const e = entry(workerId);
  e.fails += 1;
  e.lastError = message || null;
  if (e.fails >= FAILURES_BEFORE_COOLDOWN && Date.now() >= e.cooldownUntil) {
    e.cooldownUntil = Date.now() + COOLDOWN_MS;
    return true;
  }
  return false;
}

/** Anything that worked clears the slate — one bad request must not strand a proxy. */
function markSuccess(workerId) {
  const e = _health.get(workerId);
  if (!e) return;
  e.fails = 0;
  e.cooldownUntil = 0;
  e.lastError = null;
}

function isCoolingDown(workerId) {
  const e = _health.get(workerId);
  if (!e) return false;
  if (e.cooldownUntil && Date.now() < e.cooldownUntil) return true;
  if (e.cooldownUntil) {
    // Cooldown elapsed — give it a clean chance rather than tripping instantly.
    e.cooldownUntil = 0;
    e.fails = 0;
  }
  return false;
}

function cooldownRemainingMs(workerId) {
  const e = _health.get(workerId);
  if (!e?.cooldownUntil) return 0;
  return Math.max(0, e.cooldownUntil - Date.now());
}

function clearCooldown(workerId) {
  _health.delete(workerId);
}

/** For the admin panel: what the relay currently thinks of each proxy worker. */
function listHealth() {
  const out = {};
  for (const [id, e] of _health) {
    out[id] = {
      fails: e.fails,
      coolingDown: isCoolingDown(id),
      cooldownRemainingMs: cooldownRemainingMs(id),
      lastError: e.lastError,
    };
  }
  return out;
}

module.exports = {
  markTransportFailure,
  markSuccess,
  isCoolingDown,
  cooldownRemainingMs,
  clearCooldown,
  listHealth,
  FAILURES_BEFORE_COOLDOWN,
  COOLDOWN_MS,
};
