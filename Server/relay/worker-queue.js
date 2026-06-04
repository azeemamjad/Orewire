/** Serialize Playwright ops per worker so navigate + mouse do not race. */
const chains = new Map();

function runQueued(workerId, fn) {
  const prev = chains.get(workerId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(workerId, next);
  return next;
}

function clearQueue(workerId) {
  chains.delete(workerId);
}

module.exports = { runQueued, clearQueue };
