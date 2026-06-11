const { pool } = require('./pool');
const { STATUS } = require('./constants');
const { runQueued } = require('./worker-queue');
const { getPoolCounts } = require('./proxies');
const { getBrowserTask, logTaskEvent, TASK_DEFINITIONS } = require('./task-registry');
const { CaptchaRequiredError, isCaptchaLikeError, detectCaptchaOnPage, waitForCaptchaCleared } = require('./captcha');

function relayWiringEnabled() {
  return process.env.RELAY_ENABLED === 'true' && process.env.RELAY_WIRE_SCRAPERS !== 'false';
}

function tierPrefix(tier) {
  if (tier === 'res') return 'relay-res-';
  if (tier === 'dc') return 'relay-dc-';
  if (tier === 'direct') return 'relay-local-';
  return 'relay-dc-';
}

function workerIdForTask(task, slotIndex = 1, tierOverride = null) {
  const prefix = tierPrefix(tierOverride || task?.preferred_relay_tier || 'dc');
  const idx = Math.max(1, parseInt(slotIndex, 10) || 1);
  return `${prefix}${idx}`;
}

async function ensurePoolReady() {
  if (pool.workers.size > 0) return;
  if (process.env.RELAY_ENABLED !== 'true') {
    throw new Error('Relay is disabled (RELAY_ENABLED)');
  }
  await pool.startPool();
}

function tierWorkerCount(tier) {
  const c = getPoolCounts();
  if (tier === 'res') return c.resCount;
  if (tier === 'direct') return c.directCount;
  return c.dcCount;
}

// All worker ids in a tier, ordered to start at the requested slot then wrap —
// so a task prefers its assigned slot but can spill onto siblings when busy.
function candidateWorkerIds(tier, slotIndex) {
  const n = Math.max(1, tierWorkerCount(tier));
  const prefix = tierPrefix(tier);
  const start = Math.max(1, Math.min(parseInt(slotIndex, 10) || 1, n));
  const ids = [];
  for (let k = 0; k < n; k++) ids.push(`${prefix}${((start - 1 + k) % n) + 1}`);
  return ids;
}

// The "manager": hand back a healthy, idle worker in the tier. Dead/missing
// browsers are respawned before use; a busy worker is skipped for the next one;
// if every worker is busy we wait (poll) until one frees or we time out.
async function acquireManagedWorker(tier, slotIndex, taskSlug, opts = {}) {
  const ids = candidateWorkerIds(tier, slotIndex);
  const waitMs = parseInt(opts.acquireWaitMs ?? process.env.RELAY_ACQUIRE_WAIT_MS ?? '60000', 10);
  const pollMs = 1500;
  const deadline = Date.now() + Math.max(0, waitMs);
  let lastReason = 'no workers configured';

  for (;;) {
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
 * Run scrape logic on a pooled Relay browser (serialized per worker).
 * @param {string} taskSlug — browser_tasks.slug
 * @param {number} [slotIndex] — 1-based slot within tier (pipeline worker id)
 * @param {(session: { page, context, workerId }) => Promise<any>} fn
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

  const tier = opts.tier || task?.preferred_relay_tier || 'dc';
  const { worker: w, workerId } = await acquireManagedWorker(tier, slotIndex, taskSlug, opts);

  // Mid-task captcha guard: scrapers call this after each navigation. When a bot
  // wall is detected it parks the worker as needs_human, waits for a human to
  // solve it on the worker's browser (Relay View), then resumes the same run.
  const guardCaptcha = async () => {
    if (!(await detectCaptchaOnPage(w.page))) return;
    pool.setStatus(workerId, STATUS.NEEDS_HUMAN);
    await logTaskEvent({
      taskSlug,
      workerId,
      status: 'captcha_detected',
      message: `Bot wall on ${w.page.url()} — solve via Relay View; run resumes automatically`,
    }).catch(() => {});

    const cleared = await waitForCaptchaCleared(w.page);
    if (!cleared) {
      throw new CaptchaRequiredError('Captcha not solved within the wait window — aborting run', workerId);
    }
    pool.setStatus(workerId, STATUS.ACTIVE);
    await logTaskEvent({
      taskSlug,
      workerId,
      status: 'captcha_cleared',
      message: 'Bot wall cleared by human — resuming run',
    }).catch(() => {});
  };

  return runQueued(workerId, async () => {
    try {
      await pool.resetPage(workerId);
      const result = await fn({ page: w.page, context: w.context, workerId, guardCaptcha });
      if (await detectCaptchaOnPage(w.page)) {
        pool.setStatus(workerId, STATUS.NEEDS_HUMAN);
        await logTaskEvent({
          taskSlug,
          workerId,
          status: 'captcha_detected',
          message: `Captcha suspected on ${w.page.url()}`,
        });
        throw new CaptchaRequiredError('Captcha detected — open Relay View to solve', workerId);
      }
      return result;
    } catch (err) {
      if (err instanceof CaptchaRequiredError || isCaptchaLikeError(err)) {
        pool.setStatus(workerId, STATUS.NEEDS_HUMAN);
        await logTaskEvent({
          taskSlug,
          workerId,
          status: 'captcha',
          message: err.message,
        }).catch(() => {});
      }
      throw err;
    } finally {
      releaseWorker(workerId);
    }
  });
}

module.exports = {
  relayWiringEnabled,
  workerIdForTask,
  ensurePoolReady,
  withRelaySession,
};
