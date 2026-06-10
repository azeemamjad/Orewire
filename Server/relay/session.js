const { pool } = require('./pool');
const { STATUS } = require('./constants');
const { runQueued } = require('./worker-queue');
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

function workerIdForTask(task, slotIndex = 1) {
  const prefix = tierPrefix(task?.preferred_relay_tier || 'dc');
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

function acquireWorker(workerId, taskSlug) {
  const w = pool.getWorker(workerId);
  if (!w?.page) throw new Error(`Relay worker ${workerId} is not running — start the pool in Admin → Relay`);
  if (w.busy) throw new Error(`Relay worker ${workerId} is busy (${w.currentTask || 'unknown'})`);
  if (w.status === STATUS.NEEDS_HUMAN) {
    throw new Error(`Relay worker ${workerId} needs human (captcha) — solve via View link first`);
  }
  w.busy = true;
  w.currentTask = taskSlug;
  return w;
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
async function withRelaySession(taskSlug, slotIndex, fn) {
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

  const workerId = workerIdForTask(task, slotIndex);
  const w = acquireWorker(workerId, taskSlug);

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
