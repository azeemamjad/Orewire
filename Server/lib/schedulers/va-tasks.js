const { syncVaTasks } = require('../infra/va-tasks-sync');

const SYNC_INTERVAL_MS = 60 * 1000;

function startVaTasksScheduler() {
  syncVaTasks().catch((err) => console.error('[VA tasks] Initial sync failed:', err?.message || err));
  setInterval(() => {
    syncVaTasks().catch((err) => console.error('[VA tasks] Sync failed:', err?.message || err));
  }, SYNC_INTERVAL_MS);
}

module.exports = { startVaTasksScheduler };
