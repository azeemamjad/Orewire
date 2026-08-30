const { pool } = require('./pool');
const { STATUS } = require('./constants');
const { runQueued, yieldQueue, waitForQueueIdle } = require('./worker-queue');
const {
  getPoolCounts,
  getProxyWorkersForTier,
  getPrimaryProxyWorkersForTier,
  getFallbackProxyWorkersForTier,
  DIRECT_WORKER_ID,
  startUsageEvent,
  finishUsageEvent,
  refreshProxyCache,
} = require('./proxy-store');
const { isTransportError } = require('./net-errors');
const proxyHealth = require('./proxy-health');
const { getBrowserTask, logTaskEvent, TASK_DEFINITIONS } = require('./task-registry');
const {
  CaptchaRequiredError,
  isCaptchaLikeError,
  detectCaptchaOnPage,
  waitForHumanResume,
} = require('./captcha');
const {
  TaskStoppedError,
  registerSession,
  unregisterSession,
  isStopRequested,
  clearStop,
} = require('./task-cancel');

function relayWiringEnabled() {
  return process.env.RELAY_ENABLED === 'true' && process.env.RELAY_WIRE_SCRAPERS !== 'false';
}

function tierPrefix(tier) {
  if (tier === 'direct') return 'relay-direct-';
  return 'relay-proxy-';
}

function workerIdForTask(task, slotIndex = 1, tierOverride = null) {
  const tier = tierOverride || task?.preferred_relay_tier || 'dc';
  if (tier === 'direct') return DIRECT_WORKER_ID;
  const ids = getProxyWorkersForTier(tier);
  const idx = Math.max(1, parseInt(slotIndex, 10) || 1);
  return ids[(idx - 1) % ids.length] || DIRECT_WORKER_ID;
}

async function ensurePoolReady() {
  if (pool.workers.size > 0) return;
  if (process.env.RELAY_ENABLED !== 'true') {
    throw new Error('Relay is disabled (RELAY_ENABLED)');
  }
  await refreshProxyCache();
  await pool.startPool();
}

function tierWorkerCount(tier) {
  const c = getPoolCounts();
  if (tier === 'res') return c.resCount;
  if (tier === 'direct') return c.directCount;
  return c.dcCount;
}

function rotate(ids, slotIndex) {
  if (!ids.length) return [];
  const n = ids.length;
  const start = Math.max(1, Math.min(parseInt(slotIndex, 10) || 1, n));
  const out = [];
  for (let k = 0; k < n; k++) out.push(ids[((start - 1 + k) % n)]);
  return out;
}

/**
 * Worker ids for a tier, split into the ones we want to use and the ones we
 * would rather not pay for.
 *
 * Primaries are rotated so a task prefers its assigned slot but can spill onto
 * siblings when busy. Fallback-only workers (a metered provider standing behind
 * a free home tunnel) are deliberately NOT part of that rotation — they are
 * reached only when every primary is unusable, so "busy" never costs money.
 */
function candidateWorkerIds(tier, slotIndex) {
  if (tier === 'direct') return { primary: [DIRECT_WORKER_ID], fallback: [] };
  const primary = getPrimaryProxyWorkersForTier(tier);
  const fallback = getFallbackProxyWorkersForTier(tier);
  if (!primary.length && !fallback.length) return { primary: [DIRECT_WORKER_ID], fallback: [] };
  // Every proxy in the tier is marked fallback-only: treat them as primaries
  // rather than refusing to run at all.
  if (!primary.length) return { primary: rotate(fallback, slotIndex), fallback: [] };
  return { primary: rotate(primary, slotIndex), fallback };
}

// The "manager": hand back a healthy, idle worker in the tier. Dead/missing
// browsers are respawned before use; a busy worker is skipped for the next one;
// if every worker is busy we wait (poll) until one frees or we time out.
async function acquireManagedWorker(tier, slotIndex, taskSlug, opts = {}) {
  const { primary, fallback } = candidateWorkerIds(tier, slotIndex);
  const waitMs = parseInt(opts.acquireWaitMs ?? process.env.RELAY_ACQUIRE_WAIT_MS ?? '60000', 10);
  const pollMs = 1500;
  const deadline = Date.now() + Math.max(0, waitMs);
  let lastReason = 'no workers configured';
  let announcedFallback = false;

  for (;;) {
    if (opts.shouldStop?.()) throw new TaskStoppedError();

    // Primaries that have been failing at the transport layer are skipped for a
    // cooldown. Only when *every* primary is cooling down do we let the paid
    // fallback in — a busy primary is never a reason to spend.
    const livePrimary = primary.filter((id) => !proxyHealth.isCoolingDown(id));
    let ids = livePrimary;
    if (!livePrimary.length && fallback.length) {
      ids = fallback;
      if (!announcedFallback) {
        announcedFallback = true;
        console.warn(
          `[Relay] All primary '${tier}' proxies are in cooldown `
          + `(${primary.map((id) => `${id}: ${proxyHealth.listHealth()[id]?.lastError || 'failing'}`).join('; ')})`
          + ` — falling back to ${fallback.join(', ')}`,
        );
      }
    } else if (!ids.length) {
      ids = primary; // nothing live and no fallback — retry the primaries anyway
    }

    for (const id of ids) {
      let w = pool.getWorker(id);
      const dead = !w || w.status === STATUS.ERROR || !pool.isWorkerHealthy(id);
      if (dead) {
        if (w && w.busy) { lastReason = `${id} busy (recovering)`; continue; }
        try {
          w = await pool.respawnWorker(id);
          console.log(`[Relay] Manager respawned worker ${id} (was missing/unhealthy)`);
        } catch (err) {
          lastReason = `respawn ${id} failed: ${err.message}`;
          continue;
        }
      }
      if (w.status === STATUS.NEEDS_HUMAN) { lastReason = `${id} needs human (captcha)`; continue; }
      if (w.busy) { lastReason = `${id} busy (${w.currentTask || 'task'})`; continue; }
      // Claim synchronously (no await between check and set) so concurrent
      // acquires can't both grab the same worker.
      w.busy = true;
      w.currentTask = taskSlug;
      return { worker: w, workerId: id };
    }
    if (Date.now() >= deadline) {
      throw new Error(`No available '${tier}' relay worker after ${waitMs}ms — ${lastReason}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function releaseWorker(workerId) {
  const w = pool.getWorker(workerId);
  if (!w) return;
  w.busy = false;
  w.currentTask = null;
}

/**
 * Run scrape logic on a pooled Relay browser.
 * Playwright is NOT held behind one long queue lock — only reset + per-step
 * coordination use the queue so Relay View can interact between scraper steps.
 *
 * @param {string} taskSlug — browser_tasks.slug
 * @param {number} [slotIndex] — 1-based slot within tier (pipeline worker id)
 * @param {(session: { page, context, workerId, guardCaptcha, shouldStop }) => Promise<any>} fn
 */
async function withRelaySession(taskSlug, slotIndex, fn, opts = {}) {
  if (!relayWiringEnabled()) {
    throw new Error('Relay scraper wiring is off — set RELAY_ENABLED=true and RELAY_WIRE_SCRAPERS≠false');
  }

  await ensurePoolReady();
  let task = null;
  try {
    task = await getBrowserTask(taskSlug);
  } catch {
    /* DB may be unavailable in isolated scripts */
  }
  if (!task) task = TASK_DEFINITIONS.find((t) => t.slug === taskSlug);
  if (!task) throw new Error(`Unknown browser task: ${taskSlug}`);
  if (!task.needs_browser) throw new Error(`Task ${taskSlug} does not use a browser`);

  const cancelKey = opts.cancelKey || taskSlug;
  clearStop(cancelKey);
  const shouldStop = () => isStopRequested(cancelKey);

  const tier = opts.tier || task?.preferred_relay_tier || 'dc';
  const { worker: w, workerId } = await acquireManagedWorker(tier, slotIndex, taskSlug, {
    ...opts,
    shouldStop,
  });

  const proxyId = w.proxy?.proxy_id ?? null;
  let usageEventId = null;
  let usageStatus = 'success';
  let usageError = null;

  try {
    usageEventId = await startUsageEvent(proxyId, workerId, taskSlug);
  } catch {
    /* non-fatal */
  }

  registerSession(cancelKey, { workerId, taskSlug });

  async function pauseForHumanCaptcha(page, message) {
    pool.setStatus(workerId, STATUS.NEEDS_HUMAN);
    await logTaskEvent({
      taskSlug,
      workerId,
      status: 'captcha_detected',
      message: message || `Bot wall on ${page.url()} — open Relay View, solve, then Mark active`,
    }).catch(() => {});

    yieldQueue(workerId);

    const outcome = await waitForHumanResume(workerId, {
      page,
      shouldStop,
    });

    await waitForQueueIdle(workerId);

    if (outcome === 'stopped') throw new TaskStoppedError();
    if (!outcome) {
      throw new CaptchaRequiredError('Captcha not solved within the wait window — aborting run', workerId);
    }

    pool.setStatus(workerId, STATUS.ACTIVE);
    await logTaskEvent({
      taskSlug,
      workerId,
      status: 'captcha_cleared',
      message: 'Human cleared bot wall — resuming run',
    }).catch(() => {});
  }

  // Mid-task captcha guard: scrapers call this after each navigation. Parks the
  // worker as needs_human, yields the queue for Relay View, then waits until the
  // human marks the worker active again (or the wall clears on its own).
  const guardCaptcha = async () => {
    if (shouldStop()) throw new TaskStoppedError();
    if (!(await detectCaptchaOnPage(w.page))) return;
    await pauseForHumanCaptcha(w.page);
  };

  /** Serialize a single Playwright step when scrapers need explicit ordering. */
  const relayRun = (op) => runQueued(workerId, op);

  try {
    await runQueued(workerId, () => pool.resetPage(workerId));
    yieldQueue(workerId);

    const result = await fn({
      page: w.page,
      context: w.context,
      workerId,
      guardCaptcha,
      shouldStop,
      relayRun,
    });

    if (shouldStop()) throw new TaskStoppedError();

    if (await detectCaptchaOnPage(w.page)) {
      await pauseForHumanCaptcha(w.page, `Captcha suspected on ${w.page.url()}`);
    }
    // Anything that completed proves the proxy is carrying traffic.
    proxyHealth.markSuccess(workerId);
    return result;
  } catch (err) {
    if (err instanceof TaskStoppedError) {
      usageStatus = 'stopped';
      usageError = err.message;
      await logTaskEvent({
        taskSlug,
        workerId,
        status: 'stopped',
        message: err.message,
      }).catch(() => {});
      throw err;
    }
    if (err instanceof CaptchaRequiredError || isCaptchaLikeError(err)) {
      usageStatus = 'captcha';
      usageError = err.message;
      pool.setStatus(workerId, STATUS.NEEDS_HUMAN);
      await logTaskEvent({
        taskSlug,
        workerId,
        status: 'captcha',
        message: err.message,
      }).catch(() => {});
    } else {
      usageStatus = 'error';
      usageError = err?.message || String(err);
      if (isTransportError(err)) {
        const entered = proxyHealth.markTransportFailure(workerId, usageError);
        if (entered) {
          console.warn(
            `[Relay] ${workerId} taken out of rotation for `
            + `${Math.round(proxyHealth.COOLDOWN_MS / 1000)}s after `
            + `${proxyHealth.FAILURES_BEFORE_COOLDOWN} transport failures: ${usageError}`,
          );
          await logTaskEvent({
            taskSlug,
            workerId,
            status: 'proxy_cooldown',
            message: `Proxy cooling down after repeated transport failures: ${usageError}`,
          }).catch(() => {});
        }
      }
    }
    throw err;
  } finally {
    unregisterSession(cancelKey);
    releaseWorker(workerId);
    if (usageEventId) {
      finishUsageEvent(usageEventId, usageStatus, usageError).catch(() => {});
    }
  }
}

// candidateWorkerIds is exported for tests — this is the decision that keeps
// paid traffic off a healthy free proxy, so it needs to be verifiable.
module.exports = {
  candidateWorkerIds,
  relayWiringEnabled,
  workerIdForTask,
  ensurePoolReady,
  withRelaySession,
};
