const cron = require('node-cron');
const { sendDailyBriefings } = require('./send');
const { load: loadPipelineConfig } = require('../../pipeline/config');
const { shouldSkipDay, describeSkipDays } = require('../schedulers/skip-days');

const CRON_EXPR = process.env.BRIEFING_CRON || '30 7 * * *';
const TZ = process.env.BRIEFING_TIMEZONE || 'America/Toronto';

let running = false;

/**
 * Days the briefing is paused. Stored with the rest of the schedule config
 * (Admin → Pipeline → Schedules) so it can be changed without a redeploy.
 */
function briefingSkipDays() {
  try {
    return loadPipelineConfig().briefingSkipDays || [];
  } catch {
    return [];
  }
}

function startDailyBriefingScheduler() {
  if (process.env.BRIEFING_CRON_ENABLED === 'false') {
    console.log('[briefing] Scheduler disabled (BRIEFING_CRON_ENABLED=false)');
    return null;
  }

  const task = cron.schedule(
    CRON_EXPR,
    async () => {
      if (running) {
        console.warn('[briefing] Previous run still in progress — skipping');
        return;
      }

      // Paused-day gate — re-read each fire so UI changes apply without a restart.
      const gate = shouldSkipDay(briefingSkipDays(), { timeZone: TZ });
      if (gate.skip) {
        console.log(`[briefing] Paused — ${gate.dayName} is a skip day`);
        return;
      }

      running = true;
      try {
        await sendDailyBriefings();
      } finally {
        running = false;
      }
    },
    { timezone: TZ },
  );

  console.log(
    `[briefing] Scheduled daily send: "${CRON_EXPR}" (${TZ}) — ${describeSkipDays(briefingSkipDays())}`,
  );
  return task;
}

module.exports = { startDailyBriefingScheduler, briefingSkipDays };
