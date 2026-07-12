const cron = require('node-cron');
const { runSymbolHealthBatch } = require('./symbol-health');

const CRON_EXPR = process.env.SYMBOL_HEALTH_CRON || '0 7 * * *';
const TZ = process.env.SYMBOL_HEALTH_TIMEZONE || 'America/Toronto';

function startSymbolHealthScheduler() {
  if (process.env.SYMBOL_HEALTH_CRON_ENABLED === 'false') {
    console.log('[symbol-health] Scheduler disabled (SYMBOL_HEALTH_CRON_ENABLED=false)');
    return null;
  }
  if (!cron.validate(CRON_EXPR)) {
    console.error(`[symbol-health] Invalid cron expression: "${CRON_EXPR}"`);
    return null;
  }

  const task = cron.schedule(
    CRON_EXPR,
    async () => {
      try {
        const result = await runSymbolHealthBatch();
        if (result.aborted) {
          console.warn(
            `[symbol-health] Morning check ABORTED after ${result.checked} companies — providers unreachable (outage suspected), nothing flagged`,
          );
        } else {
          console.log(
            `[symbol-health] Morning check: ${result.checked} companies, ${result.flagged} newly flagged, ${result.cleared} cleared`
            + ` (${result.missing} missing, ${result.unknown} transient/skipped)`,
          );
        }
      } catch (err) {
        console.error('[symbol-health] Batch failed:', err?.message || err);
      }
    },
    { timezone: TZ },
  );

  console.log(`[symbol-health] Scheduled daily check: "${CRON_EXPR}" (${TZ})`);
  return task;
}

module.exports = { startSymbolHealthScheduler };
