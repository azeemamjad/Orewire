/**
 * Cron for the template-driven material posting pipeline.
 * Replaces the old curated-daily-thread scheduler (lib/social/scheduler.js), which is
 * kept in the tree but no longer started.
 */
const cron = require('node-cron');
const { getSettings } = require('./settings');
const { runMaterialTick } = require('./material-run');

let task = null;
let running = false;

async function tick() {
  if (running) {
    console.warn('[material] Previous tick still in progress — skipping');
    return;
  }
  running = true;
  try {
    const result = await runMaterialTick({ trigger: 'cron' });
    if (result.skipped) {
      console.log(`[material] Skipped: ${result.reason}`);
    } else if (result.ok) {
      console.log(`[material] ${result.status} ${result.category} @${result.ticker} (row #${result.id})`);
    } else {
      console.error(`[material] Not posted: ${result.reason || result.error}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  } catch (err) {
    console.error('[material] Tick error:', err?.message || err);
  } finally {
    running = false;
  }
}

function stopMaterialScheduler() {
  if (task) {
    try {
      task.stop();
    } catch {
      /* ignore */
    }
    task = null;
  }
}

async function startMaterialScheduler() {
  if (process.env.SOCIAL_MATERIAL_CRON_ENABLED === 'false') {
    console.log('[material] Scheduler disabled (SOCIAL_MATERIAL_CRON_ENABLED=false)');
    return null;
  }

  stopMaterialScheduler();

  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    console.error('[material] Failed to load settings for scheduler:', err?.message || err);
    settings = { material_cron: '*/30 * * * *', timezone: process.env.BRIEFING_TIMEZONE || 'America/Toronto' };
  }

  const expr = process.env.SOCIAL_MATERIAL_CRON || settings.material_cron || '*/30 * * * *';
  const tz = settings.timezone || 'America/Toronto';

  if (!cron.validate(expr)) {
    console.error(`[material] Invalid cron expression: ${expr}`);
    return null;
  }

  task = cron.schedule(expr, () => { tick(); }, { timezone: tz });
  console.log(`[material] Scheduled material posts: "${expr}" (${tz})`);
  return task;
}

/** Re-read settings and reschedule (after an admin change to cron/timezone). */
async function rescheduleMaterialScheduler() {
  return startMaterialScheduler();
}

module.exports = {
  startMaterialScheduler,
  stopMaterialScheduler,
  rescheduleMaterialScheduler,
  tick,
};
