/**
 * Smoke test: pipeline scrapers use Relay pool (not spawn-per-job browsers).
 * Run with server .env loaded: npm run relay:test-wire
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function ensureDb() {
  try {
    await require('../db/migrate')();
  } catch (err) {
    console.warn('[test] migrate skipped:', err.message);
  }
}

const { relayWiringEnabled } = require('../relay/scrape');
const { withRelaySession } = require('../relay/session');
const { pool } = require('../relay/pool');
const { refreshProxyCache, getProxyWorkersForTier } = require('../relay/proxy-store');

async function main() {
  await ensureDb();
  await refreshProxyCache();

  if (!relayWiringEnabled()) {
    console.error('SKIP: RELAY_ENABLED or RELAY_WIRE_SCRAPERS is off');
    process.exit(0);
  }

  if (pool.workers.size === 0) {
    console.log('[test] Starting relay pool…');
    await pool.startPool();
  }

  const dcWorkers = getProxyWorkersForTier('dc');
  const resWorkers = getProxyWorkersForTier('res');
  if (!dcWorkers.length) {
    console.warn('[test] No datacenter proxies in DB — skipping ASX tier check');
  } else {
    console.log(`[test] Session on ${dcWorkers[0]} (ASX tier)…`);
    await withRelaySession('asx_filings', 1, async ({ page, workerId }) => {
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const title = await page.title();
      console.log(`[test] ${workerId} title: ${title}`);
      if (!title) throw new Error('empty title');
    });
  }

  if (!resWorkers.length) {
    console.warn('[test] No residential proxies in DB — skipping SEDAR tier check');
  } else {
    console.log(`[test] Session on ${resWorkers[0]} (SEDAR tier)…`);
    await withRelaySession('sedar_filings', 1, async ({ page, workerId }) => {
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(`[test] ${workerId} ok`);
    });
  }

  console.log('[test] All relay wiring checks passed');
  await pool.shutdown();
}

main().catch((err) => {
  console.error('[test] FAILED:', err.message);
  process.exit(1);
});
