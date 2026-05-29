// MarketScreener profile + people scraper.
//
// Two entry points:
//   1. CLI:        node scripts/scrape-profiles.js [--limit N] [--ticker XYZ] [--refresh DAYS] [--delay MS] [--dry-run]
//   2. Programmatic: require('./scripts/scrape-profiles').runProfileScrape({ ... })
//
// Logs go to the shared pipeline state when called programmatically (so the admin
// panel's log viewer streams them). When called from the CLI we also mirror to console.

require('dotenv').config();
const db = require('../db');
const ms = require('../pipeline/marketscreener');
const { addLog } = require('../pipeline/state');

let _running = false;

function parseArgs(argv) {
  const args = { limit: null, ticker: null, refreshDays: null, delay: 2500, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--limit') { args.limit = parseInt(next, 10); i++; }
    else if (a === '--ticker') { args.ticker = next; i++; }
    else if (a === '--refresh') { args.refreshDays = parseInt(next, 10); i++; }
    else if (a === '--delay') { args.delay = parseInt(next, 10); i++; }
    else if (a === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchCompaniesToScrape({ limit, ticker, refreshDays }) {
  if (ticker) {
    const r = await db.query(
      `SELECT id, exchange, ticker, name, ms_slug FROM companies WHERE UPPER(ticker) = UPPER($1) LIMIT 1`,
      [ticker]
    );
    return r.rows;
  }
  const conditions = ['name IS NOT NULL'];
  if (refreshDays != null) {
    conditions.push(`(profile_scraped_at IS NULL OR profile_scraped_at < NOW() - INTERVAL '${refreshDays} days')`);
  } else {
    conditions.push('profile_scraped_at IS NULL');
  }
  const sql = `
    SELECT id, exchange, ticker, name, ms_slug
    FROM companies
    WHERE ${conditions.join(' AND ')}
    ORDER BY market_cap DESC NULLS LAST, id ASC
    ${limit ? `LIMIT ${limit}` : ''}
  `;
  const r = await db.query(sql);
  return r.rows;
}

async function saveProfile(companyId, slug, profile) {
  await db.query(
    `UPDATE companies SET
       description        = COALESCE($2, description),
       website            = COALESCE($3, website),
       headquarters       = COALESCE($4, headquarters),
       ms_slug            = COALESCE($5, ms_slug),
       profile_scraped_at = NOW(),
       updated_at         = NOW()
     WHERE id = $1`,
    [companyId, profile?.description || null, profile?.website || null, profile?.headquarters || null, slug || null]
  );
}

async function savePeople(companyId, people) {
  if (!Array.isArray(people) || people.length === 0) return 0;
  await db.query(`DELETE FROM company_people WHERE company_id = $1`, [companyId]);
  let saved = 0;
  for (const p of people) {
    try {
      await db.query(
        `INSERT INTO company_people (company_id, name, role_code, title, age, since_year, kind, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'marketscreener', NOW())
         ON CONFLICT (company_id, name, kind) DO UPDATE SET
           role_code  = EXCLUDED.role_code,
           title      = EXCLUDED.title,
           age        = EXCLUDED.age,
           since_year = EXCLUDED.since_year,
           updated_at = NOW()`,
        [companyId, p.name, p.role_code, p.title, p.age, p.since_year, p.kind]
      );
      saved++;
    } catch (e) {
      addLog('warn', `[Profiles]   ! failed to save "${p.name}": ${e.message}`);
    }
  }
  return saved;
}

function isRunning() {
  return _running;
}

/**
 * Run the scraper. Resolves with summary { ok, miss, fail }.
 * Logs progress through pipeline state's addLog so the admin panel log viewer shows it.
 */
async function runProfileScrape(opts = {}) {
  if (_running) {
    const err = new Error('Profile scrape already running');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }
  _running = true;
  const args = {
    limit: opts.limit != null ? Number(opts.limit) : null,
    ticker: opts.ticker || null,
    refreshDays: opts.refreshDays != null ? Number(opts.refreshDays) : null,
    delay: opts.delay != null ? Math.max(0, Number(opts.delay)) : 2500,
    dryRun: !!opts.dryRun,
  };
  addLog('out', `[Profiles] Starting MarketScreener scrape: ${JSON.stringify(args)}`);
  try {
    const companies = await fetchCompaniesToScrape(args);
    addLog('out', `[Profiles] ${companies.length} companies queued`);
    let ok = 0, miss = 0, fail = 0;
    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      const tag = `[${i + 1}/${companies.length}] ${c.ticker || '?'} ${c.name?.slice(0, 50)}`;
      try {
        const result = await ms.scrapeCompany({
          slug: c.ms_slug || null,
          query: c.name,
          ticker: c.ticker,
          exchange: c.exchange,
        });
        if (!result.slug) {
          addLog('warn', `[Profiles] ${tag} — NO MATCH on MarketScreener`);
          miss++;
        } else if (args.dryRun) {
          addLog('out', `[Profiles] ${tag} — slug=${result.slug} people=${result.people.length} (dry-run)`);
          ok++;
        } else {
          await saveProfile(c.id, result.slug, result.profile);
          const peopleSaved = await savePeople(c.id, result.people);
          addLog('out', `[Profiles] ${tag} — slug=${result.slug}, people=${peopleSaved}/${result.people.length}, desc=${result.profile?.description ? 'yes' : 'no'}, web=${result.profile?.website ? 'yes' : 'no'}`);
          ok++;
        }
      } catch (e) {
        addLog('err', `[Profiles] ${tag} — ERROR: ${e.message}`);
        fail++;
      }
      if (i < companies.length - 1 && args.delay > 0) await sleep(args.delay);
    }
    const summary = { total: companies.length, ok, miss, fail };
    addLog('out', `[Profiles] Done. ok=${ok} miss=${miss} fail=${fail}`);
    return summary;
  } finally {
    _running = false;
  }
}

// CLI mode — only when invoked directly via `node scripts/scrape-profiles.js`
if (require.main === module) {
  const args = parseArgs(process.argv);
  console.log(`[scrape-profiles] options:`, args);
  // Mirror addLog output to console for the CLI run
  const { state } = require('../pipeline/state');
  let lastSeen = state.logs.length;
  const consoleTimer = setInterval(() => {
    while (lastSeen < state.logs.length) {
      const entry = state.logs[lastSeen++];
      const fn = entry.level === 'err' ? console.error : entry.level === 'warn' ? console.warn : console.log;
      fn(entry.msg);
    }
  }, 250);
  runProfileScrape(args)
    .then(summary => {
      clearInterval(consoleTimer);
      console.log('\nSummary:', summary);
      process.exit(0);
    })
    .catch(err => {
      clearInterval(consoleTimer);
      console.error('Fatal:', err);
      process.exit(1);
    });
}

module.exports = { runProfileScrape, isRunning };
