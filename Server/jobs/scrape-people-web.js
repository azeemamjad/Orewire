/**
 * People rebuild job: visit each company's own website and extract its real
 * Management + Board of Directors with AI, replacing the stale exchange/legacy
 * data. Confidence-gated and manual-preserving (see lib/companies/people-save).
 *
 *   node jobs/scrape-people-web.js --limit 20
 *   node jobs/scrape-people-web.js --ticker ELD
 *   node jobs/scrape-people-web.js --all --dry-run
 */
require('dotenv').config();
const db = require('../db');
const { isJobRunning, syncJob, startJob, endJob } = require('../lib/job-tracker');
const { isAiPaused } = require('../lib/ai/ai-settings');
const { extractPeopleForCompany, PEOPLE_APPLY_MIN_CONFIDENCE } = require('../lib/companies/people-extract');
const { savePeopleFromWebsite } = require('../lib/companies/people-save');

const JOB_ID = 'people-web';

function isRunning() {
  syncJob(JOB_ID);
  return isJobRunning(JOB_ID);
}

async function fetchCompanies({ limit = null, ticker = null, all = false } = {}) {
  const params = [];
  const where = [`website IS NOT NULL AND website <> ''`];
  if (!all) where.push(`people_scraped_at IS NULL`); // backfill: never-checked only
  if (ticker) {
    params.push(String(ticker).toUpperCase());
    where.push(`UPPER(ticker) = $${params.length}`);
  }
  let sql = `SELECT id, name, exchange, ticker, website
               FROM companies
              WHERE ${where.join(' AND ')}
              ORDER BY market_cap DESC NULLS LAST`;
  if (limit) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  const r = await db.query(sql, params);
  return r.rows;
}

async function markChecked(id) {
  try {
    await db.query(`UPDATE companies SET people_scraped_at = NOW() WHERE id = $1`, [id]);
  } catch { /* ignore */ }
}

async function runPeopleWebScrape(opts = {}) {
  syncJob(JOB_ID);
  if (isRunning()) {
    const err = new Error('People web scrape already running');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }
  if (await isAiPaused()) {
    console.log('[people-web] AI is paused — skipping run.');
    return { skipped: 'ai_paused' };
  }

  const args = {
    limit: opts.limit != null ? Number(opts.limit) : null,
    ticker: opts.ticker || null,
    all: !!opts.all,
    dryRun: !!opts.dryRun,
    delay: opts.delay != null ? Math.max(0, Number(opts.delay)) : 1500,
  };

  startJob(JOB_ID, { label: 'People rebuild (website + AI)', pid: process.pid, type: 'in-process', meta: args });
  const stats = { checked: 0, applied: 0, insertedPeople: 0, lowConfidence: 0, noContent: 0, failed: 0 };

  try {
    const companies = await fetchCompanies(args);
    console.log(`[people-web] ${companies.length} companies to process`);

    for (const c of companies) {
      stats.checked += 1;
      const tag = `[${stats.checked}/${companies.length}] ${c.exchange}:${c.ticker} ${String(c.name).slice(0, 40)}`;
      try {
        const result = await extractPeopleForCompany(c);
        if (!result.ok) {
          // AI errors are transient → leave unstamped to retry; site/content
          // failures are stamped so the backfill terminates.
          if (String(result.reason).startsWith('ai_error')) {
            stats.failed += 1;
            console.warn(`[people-web] ${tag} — ${result.reason} (retry later)`);
          } else {
            stats.noContent += 1;
            if (!args.dryRun) await markChecked(c.id);
            console.log(`[people-web] ${tag} — ${result.reason}`);
          }
          continue;
        }

        const pct = (result.confidence * 100).toFixed(0);
        if (args.dryRun) {
          const wouldApply = result.confidence >= PEOPLE_APPLY_MIN_CONFIDENCE && result.people.length > 0;
          if (wouldApply) stats.applied += 1;
          console.log(`[people-web] ${tag} — ${result.people.length} people @ ${pct}% ${wouldApply ? 'WOULD apply' : '(below bar)'} [dry-run]`);
          continue;
        }

        const saved = await savePeopleFromWebsite(c.id, {
          people: result.people,
          confidence: result.confidence,
          sourceUrl: result.sourceUrl,
        });
        if (saved.applied) {
          stats.applied += 1;
          stats.insertedPeople += saved.inserted || 0;
          console.log(`[people-web] ${tag} — applied ${saved.inserted} people @ ${pct}%`);
        } else {
          if (saved.reason === 'low_confidence') stats.lowConfidence += 1;
          console.log(`[people-web] ${tag} — kept existing (${saved.reason}, ${pct}%)`);
        }
      } catch (err) {
        stats.failed += 1;
        console.warn(`[people-web] ${tag} — error: ${err.message}`);
      }
      if (args.delay) await new Promise((r) => setTimeout(r, args.delay));
    }

    endJob(JOB_ID, 'completed');
    console.log(`[people-web] Done: ${JSON.stringify(stats)}`);
    return stats;
  } catch (err) {
    endJob(JOB_ID, 'error');
    throw err;
  }
}

module.exports = { runPeopleWebScrape, isRunning, JOB_ID };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const opts = {
    limit: getArg('limit'),
    ticker: getArg('ticker'),
    all: argv.includes('--all'),
    dryRun: argv.includes('--dry-run'),
  };
  runPeopleWebScrape(opts)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[people-web] Failed:', err?.message || err);
      process.exit(1);
    });
}
