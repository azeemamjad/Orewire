const cron = require('node-cron');
const { getSettings } = require('./settings');
const { runSocialPost } = require('./run');

let task = null;
let running = false;

async function tick() {
  if (running) {
    console.warn('[social] Previous cron run still in progress — skipping');
    return;
  }
  running = true;
  try {
    const result = await runSocialPost({ trigger: 'cron' });
    if (result.skipped) {
      console.log(`[social] Cron skipped: ${result.reason}`);
    } else if (result.ok) {
      console.log(`[social] Cron posted thread (run #${result.runId}, dryRun=${!!result.dryRun})`);
    } else {
      console.error(`[social] Cron failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[social] Cron error:', err?.message || err);
  } finally {
    running = false;
  }
}

function stopSocialScheduler() {
  if (task) {
    try {
      task.stop();
    } catch {
      /* ignore */
    }
    task = null;
  }
}

async function startSocialScheduler() {
  if (process.env.SOCIAL_X_CRON_ENABLED === 'false') {
    console.log('[social] Scheduler disabled (SOCIAL_X_CRON_ENABLED=false)');
    return null;
  }

  stopSocialScheduler();

  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    console.error('[social] Failed to load settings for scheduler:', err?.message || err);
    settings = {
      cron: process.env.SOCIAL_X_CRON || '0 8 * * *',
      timezone: process.env.BRIEFING_TIMEZONE || 'America/Toronto',
    };
  }

  const expr = process.env.SOCIAL_X_CRON || settings.cron || '0 8 * * *';
  const tz = settings.timezone || 'America/Toronto';

  if (!cron.validate(expr)) {
    console.error(`[social] Invalid cron expression: ${expr}`);
    return null;
  }

  task = cron.schedule(expr, () => { tick(); }, { timezone: tz });
  console.log(`[social] Scheduled daily X thread: "${expr}" (${tz})`);
  return task;
}

/** Re-read settings and reschedule (after admin updates cron). */
async function rescheduleSocialScheduler() {
  return startSocialScheduler();
}

module.exports = {
  startSocialScheduler,
  stopSocialScheduler,
  rescheduleSocialScheduler,
};
