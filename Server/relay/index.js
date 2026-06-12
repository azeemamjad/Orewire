const { attachRelayViewer } = require('./viewer');
const { pool } = require('./pool');
const { assertRelaySecretsConfigured } = require('./security');
const { seedBrowserTasks } = require('./task-registry');

async function initRelay(app, httpServer) {
  assertRelaySecretsConfigured();
  try {
    await seedBrowserTasks();
    console.log('[Relay] Browser task catalog synced to database');
  } catch (err) {
    console.error('[Relay] browser_tasks seed failed:', err.message);
  }
  attachRelayViewer(app, httpServer);
  // Routes are mounted on app in index.js before listen

  const enabled = process.env.RELAY_ENABLED === 'true';
  const autoStart = parseInt(process.env.RELAY_AUTO_START || '0', 10);

  if (enabled && autoStart > 0) {
    try {
      await pool.startPool();
      const { getPoolCounts } = require('./proxies');
      const { total } = getPoolCounts();
      console.log(`[Relay] Auto-started pool (${total} workers)`);
    } catch (err) {
      console.error('[Relay] Auto-start failed:', err.message);
    }
  }

  if (enabled) pool.startZombieSweep();

  const shutdownRelay = () => {
    pool.shutdown().catch(() => {});
  };
  process.on('SIGINT', shutdownRelay);
  process.on('SIGTERM', shutdownRelay);

  return pool;
}

module.exports = { initRelay, pool };
