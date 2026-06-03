const cron = require('node-cron');
const { sendDailyBriefings } = require('./daily-briefing');

const CRON_EXPR = process.env.BRIEFING_CRON || '30 7 * * *';
const TZ = process.env.BRIEFING_TIMEZONE || 'America/Toronto';

let running = false;

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
      running = true;
      try {
        await sendDailyBriefings();
      } finally {
        running = false;
      }
    },
    { timezone: TZ },
  );

  console.log(`[briefing] Scheduled daily send: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startDailyBriefingScheduler };
