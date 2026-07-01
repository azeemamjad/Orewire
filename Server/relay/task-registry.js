/**
 * Catalog of OreWire processes that use (or don't use) a real browser.
 * Persisted in browser_tasks — used to plan Relay worker assignment and captcha handling.
 *
 * One Relay worker = one browser at a time. Do not run SEDAR+ and ASX concurrently
 * on the same worker; after captcha on a worker, mark needs_human before other sites.
 */

const db = require('../db');

/** @type {Array<object>} */
const TASK_DEFINITIONS = [
  {
    slug: 'sedar_filings',
    name: 'SEDAR+ filings download',
    category: 'filings',
    script_entry: 'Server/lib/scraper/runners/sedar.js',
    exchange: 'TSX,TSXV,CSE',
    needs_browser: true,
    needs_captcha: true,
    captcha_site: 'sedarplus.ca',
    preferred_relay_tier: 'res',
    relay_worker_id: null,
    notes: 'Main Canadian filing scrape via sedarplus.ca search. Often blocks bots — use RES or post-captcha DC.',
  },
  {
    slug: 'sedar_transfer_agent',
    name: 'SEDAR+ transfer agent (issuer profile)',
    category: 'enrichment',
    script_entry: 'Server/lib/scraper/runners/transfer-agents.js',
    exchange: 'TSX,TSXV',
    needs_browser: true,
    needs_captcha: true,
    captcha_site: 'sedarplus.ca',
    preferred_relay_tier: 'res',
    relay_worker_id: null,
    notes: 'Same SEDAR+ session as filings; share a worker only sequentially after captcha cleared.',
  },
  {
    slug: 'pipeline_transfer_agents',
    name: 'Pipeline transfer agents batch',
    category: 'enrichment',
    script_entry: 'Server/jobs/scrape-transfer-agents.js',
    exchange: 'TSX,TSXV',
    needs_browser: true,
    needs_captcha: true,
    captcha_site: 'sedarplus.ca',
    preferred_relay_tier: 'res',
    relay_worker_id: null,
    notes: 'Admin pipeline job — in-process transfer-agent batch; same captcha rules as SEDAR filings.',
  },
  {
    slug: 'sedar_manual',
    name: 'SEDAR+ manual scrape (admin)',
    category: 'admin',
    script_entry: 'Server/lib/scraper/runners/sedar.js',
    exchange: 'TSX,TSXV,CSE',
    needs_browser: true,
    needs_captcha: true,
    captcha_site: 'sedarplus.ca',
    preferred_relay_tier: 'res',
    relay_worker_id: null,
    notes: 'POST /api/scraper/run for non-ASX companies.',
  },
  {
    slug: 'asx_filings',
    name: 'ASX filings download',
    category: 'filings',
    script_entry: 'Server/lib/scraper/runners/asx.js',
    exchange: 'ASX',
    needs_browser: true,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: 'dc',
    relay_worker_id: null,
    notes: 'ASX announcements site — different from SEDAR+. Use DC workers; not the same session as SEDAR+.',
  },
  {
    slug: 'asx_manual',
    name: 'ASX manual scrape (admin)',
    category: 'admin',
    script_entry: 'Server/lib/scraper/runners/asx.js',
    exchange: 'ASX',
    needs_browser: true,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: 'dc',
    relay_worker_id: null,
    notes: 'Admin Run Scraper for ASX tickers.',
  },
  {
    slug: 'cse_seed',
    name: 'CSE company list seed',
    category: 'seed',
    script_entry: 'Server/lib/scraper/runners/cse-seed.js',
    exchange: 'CSE',
    needs_browser: true,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: 'dc',
    relay_worker_id: null,
    notes: 'Downloads Excel from thecse.com — browser only, rare captcha.',
  },
  {
    slug: 'asx_seed',
    name: 'ASX company list seed',
    category: 'seed',
    script_entry: 'Server/lib/scraper/runners/asx-seed.js',
    exchange: 'ASX',
    needs_browser: true,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: 'dc',
    relay_worker_id: null,
    notes: 'Downloads CSV from asx.com directory.',
  },
  {
    slug: 'pipeline_sedar_batch',
    name: 'Pipeline batch (SEDAR companies)',
    category: 'filings',
    script_entry: 'Server/pipeline/runner.js → index.js',
    exchange: 'TSX,TSXV,CSE',
    needs_browser: true,
    needs_captcha: true,
    captcha_site: 'sedarplus.ca',
    preferred_relay_tier: 'res',
    relay_worker_id: null,
    notes: 'Spawns child node processes today; future: assign Relay workers per company.',
  },
  {
    slug: 'pipeline_asx_batch',
    name: 'Pipeline batch (ASX companies)',
    category: 'filings',
    script_entry: 'Server/pipeline/runner.js → asx-filings.js',
    exchange: 'ASX',
    needs_browser: true,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: 'dc',
    relay_worker_id: null,
    notes: 'ASX-only pipeline — prefer DC pool, not workers stuck on SEDAR captcha.',
  },
  {
    slug: 'profile_enrichment',
    name: 'Company profiles (CSE / ASX / TMX APIs)',
    category: 'enrichment',
    script_entry: 'Server/jobs/scrape-profiles.js',
    exchange: 'ALL',
    needs_browser: false,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: null,
    relay_worker_id: null,
    notes: 'HTTP/API only — no Relay browser.',
  },
  {
    slug: 'tsx_seed',
    name: 'TSX / TSXV list seed',
    category: 'seed',
    script_entry: 'Server/routes/seeder.js POST /tsx',
    exchange: 'TSX,TSXV',
    needs_browser: false,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: null,
    relay_worker_id: null,
    notes: 'Direct HTTP download of TSX Excel — no Playwright.',
  },
  {
    slug: 'filing_analyze',
    name: 'Filing PDF analysis (Ollama)',
    category: 'enrichment',
    script_entry: 'Server/lib/scraper/runners/analyze-one.js',
    exchange: 'ALL',
    needs_browser: false,
    needs_captcha: false,
    captcha_site: null,
    preferred_relay_tier: null,
    relay_worker_id: null,
    notes: 'AI on downloaded PDFs — no browser.',
  },
];

async function seedBrowserTasks() {
  for (const t of TASK_DEFINITIONS) {
    await db.query(
      `INSERT INTO browser_tasks (
        slug, name, category, script_entry, exchange,
        needs_browser, needs_captcha, captcha_site,
        preferred_relay_tier, relay_worker_id, notes, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        script_entry = EXCLUDED.script_entry,
        exchange = EXCLUDED.exchange,
        needs_browser = EXCLUDED.needs_browser,
        needs_captcha = EXCLUDED.needs_captcha,
        captcha_site = EXCLUDED.captcha_site,
        preferred_relay_tier = EXCLUDED.preferred_relay_tier,
        relay_worker_id = COALESCE(EXCLUDED.relay_worker_id, browser_tasks.relay_worker_id),
        notes = EXCLUDED.notes,
        enabled = EXCLUDED.enabled,
        updated_at = NOW()`,
      [
        t.slug,
        t.name,
        t.category,
        t.script_entry,
        t.exchange,
        t.needs_browser,
        t.needs_captcha,
        t.captcha_site,
        t.preferred_relay_tier,
        t.relay_worker_id,
        t.notes,
        true,
      ]
    );
  }
}

async function listBrowserTasks() {
  const r = await db.query(
    `SELECT slug, name, category, script_entry, exchange,
            needs_browser, needs_captcha, captcha_site,
            preferred_relay_tier, relay_worker_id, notes, enabled,
            updated_at
     FROM browser_tasks
     ORDER BY needs_browser DESC, needs_captcha DESC, category, slug`
  );
  return r.rows;
}

async function getBrowserTask(slug) {
  const r = await db.query(`SELECT * FROM browser_tasks WHERE slug = $1`, [slug]);
  return r.rows[0] || null;
}

async function logTaskEvent({ taskSlug, workerId, status, message, companyTicker }) {
  await db.query(
    `INSERT INTO relay_task_events (task_slug, worker_id, status, message, company_ticker)
     VALUES ($1,$2,$3,$4,$5)`,
    [taskSlug, workerId || null, status, message || null, companyTicker || null]
  );
}

async function listRecentTaskEvents(limit = 50) {
  const r = await db.query(
    `SELECT e.id, e.task_slug, e.worker_id, e.status, e.message, e.company_ticker, e.created_at,
            t.name AS task_name, t.needs_captcha
     FROM relay_task_events e
     LEFT JOIN browser_tasks t ON t.slug = e.task_slug
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

module.exports = {
  TASK_DEFINITIONS,
  seedBrowserTasks,
  listBrowserTasks,
  getBrowserTask,
  logTaskEvent,
  listRecentTaskEvents,
};
