/** Serialize Playwright ops per worker so navigate + mouse do not race. */
const chains = new Map();

function runQueued(workerId, fn, opts = {}) {
  const priority = opts.priority === true;
  if (priority) {
    const next = Promise.resolve().then(fn);
    chains.set(workerId, next);
    return next;
  }
  const prev = chains.get(workerId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(workerId, next);
  return next;
}

/** Let Relay View (or another client) run while a scraper is idle or waiting for a human. */
function yieldQueue(workerId) {
  chains.set(workerId, Promise.resolve());
}

/** Wait until queued Playwright work finishes (e.g. after a human clicked in Relay View). */
async function waitForQueueIdle(workerId, timeoutMs = 8000) {
  const tail = chains.get(workerId) || Promise.resolve();
  let timer;
  await Promise.race([
    tail.catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function clearQueue(workerId) {
  chains.delete(workerId);
}

module.exports = { runQueued, yieldQueue, waitForQueueIdle, clearQueue };
