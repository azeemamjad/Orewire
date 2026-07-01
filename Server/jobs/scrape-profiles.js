// Exchange-sourced company profile + people scraper (CSE / ASX / TMX).
// Replaces the former MarketScreener enrichment — data now comes straight from
// each listing venue's official feed (see ../pipeline/exchanges.js).
//
// Two entry points:
//   1. CLI:        node jobs/scrape-profiles.js [--limit N] [--ticker XYZ] [--refresh DAYS] [--delay MS] [--dry-run]
//   2. Programmatic: require('../jobs/scrape-profiles').runProfileScrape({ ... })
//
// Logs go to the shared pipeline state when called programmatically (so the admin
// panel's log viewer streams them). When called from the CLI we also mirror to console.

require('dotenv').config();
const db = require('../db');
const exch = require('../pipeline/exchanges');
const { addLog } = require('../pipeline/state');
const {
  isJobRunning, syncJob, startJob, endJob,
} = require('../lib/job-tracker');

const JOB_ID = 'profiles';

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
    // A ticker can exist on more than one exchange (e.g. ACM on CSE + ASX) — enrich every match.
    const r = await db.query(
      `SELECT id, exchange, ticker, name FROM companies WHERE UPPER(ticker) = UPPER($1) ORDER BY exchange, id`,
      [ticker]
    );
    return r.rows;
  }
  const conditions = ['name IS NOT NULL', "ticker IS NOT NULL AND ticker <> ''"];
  if (refreshDays != null) {
    // Only re-scrape companies whose profile is stale (or never scraped).
    conditions.push(`(profile_scraped_at IS NULL OR profile_scraped_at < NOW() - INTERVAL '${refreshDays} days')`);
  }
  // Blank refreshDays → re-fetch ALL companies. saveProfile() uses COALESCE, so a
  // field the venue leaves blank never wipes existing data; new values overwrite.
  const sql = `
    SELECT id, exchange, ticker, name
    FROM companies
    WHERE ${conditions.join(' AND ')}
    ORDER BY market_cap DESC NULLS LAST, id ASC
    ${limit ? `LIMIT ${limit}` : ''}
  `;
  const r = await db.query(sql);
  return r.rows;
}

async function saveProfile(companyId, source, profile) {
  // COALESCE(new, existing): exchange data wins where present, but a field the
  // venue leaves blank never wipes data we already hold.
  await db.query(
    `UPDATE companies SET
       description        = COALESCE($2, description),
       website            = COALESCE($3, website),
       headquarters       = COALESCE($4, headquarters),
       transfer_agent     = COALESCE($5, transfer_agent),
       phone              = COALESCE($6, phone),
       shares_outstanding = COALESCE($7, shares_outstanding),
       profile_source     = $8,
       profile_scraped_at = NOW(),
       updated_at         = NOW()
     WHERE id = $1`,
    [
      companyId,
      profile?.description || null,
      profile?.website || null,
      profile?.headquarters || null,
      profile?.transfer_agent || null,
      profile?.phone || null,
      profile?.shares_outstanding ?? null,
      source || null,
    ]
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (company_id, name, kind) DO UPDATE SET
           role_code  = EXCLUDED.role_code,
           title      = EXCLUDED.title,
           age        = EXCLUDED.age,
           since_year = EXCLUDED.since_year,
           source     = EXCLUDED.source,
           updated_at = NOW()`,
        [companyId, p.name, p.role_code ?? null, p.title ?? null, p.age ?? null, p.since_year ?? null, p.kind, p.source || 'exchange']
      );
      saved++;
    } catch (e) {
      addLog('warn', `[Profiles]   ! failed to save "${p.name}": ${e.message}`);
    }
  }
  return saved;
}

let _running = false;

function isRunning() {
  syncJob(JOB_ID);
  return _running || isJobRunning(JOB_ID);
}

/**
 * Run the scraper. Resolves with summary { ok, miss, fail }.
 * Logs progress through pipeline state's addLog so the admin panel log viewer shows it.
 */
async function runProfileScrape(opts = {}) {
  syncJob(JOB_ID);
  if (isRunning()) {
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
  addLog('out', `[Profiles] Starting exchange profile scrape (CSE/ASX/TMX): ${JSON.stringify(args)}`);
  startJob(JOB_ID, { label: 'Profile scrape (CSE/ASX/TMX)', pid: process.pid, type: 'in-process', meta: args });
  try {
    const companies = await fetchCompaniesToScrape(args);
    addLog('out', `[Profiles] ${companies.length} companies queued`);
    let ok = 0, miss = 0, fail = 0;
    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      const tag = `[${i + 1}/${companies.length}] ${c.exchange || '?'}:${c.ticker || '?'} ${c.name?.slice(0, 50)}`;
      try {
        const result = await exch.scrapeCompany({
          exchange: c.exchange,
          ticker: c.ticker,
          name: c.name,
        });
        if (!result.matched) {
          addLog('warn', `[Profiles] ${tag} — NO MATCH (${result.source || '?'}: ${result.note || 'unknown'})`);
          miss++;
        } else if (args.dryRun) {
          addLog('out', `[Profiles] ${tag} — src=${result.source} people=${result.people.length} ta=${result.profile?.transfer_agent ? 'yes' : 'no'} (dry-run)`);
          ok++;
        } else {
          await saveProfile(c.id, result.source, result.profile);
          const peopleSaved = await savePeople(c.id, result.people);
          addLog('out', `[Profiles] ${tag} — src=${result.source}, people=${peopleSaved}/${result.people.length}, desc=${result.profile?.description ? 'yes' : 'no'}, web=${result.profile?.website ? 'yes' : 'no'}, ta=${result.profile?.transfer_agent ? 'yes' : 'no'}`);
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
    endJob(JOB_ID, 'completed');
    return summary;
  } catch (err) {
    endJob(JOB_ID, 'failed');
    throw err;
  } finally {
    _running = false;
  }
}

// CLI mode — only when invoked directly via `node jobs/scrape-profiles.js`
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
