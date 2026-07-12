/**
 * Ticker-recheck job: for companies that remain flagged after the stricter
 * symbol-health batch, research the current listing on the web and file a VA
 * suggestion task. Runs daily (see lib/schedulers/ticker-recheck.js) or via CLI.
 *
 *   node jobs/ticker-recheck.js --limit 20
 *   node jobs/ticker-recheck.js --ticker ABC
 */
require('dotenv').config();
const db = require('../db');
const { isJobRunning, syncJob, startJob, endJob } = require('../lib/job-tracker');
const { isAiPaused } = require('../lib/ai/ai-settings');
const { FAIL_THRESHOLD } = require('../lib/market/symbol-health');
const { suggestTickerForCompany, createTickerSuggestionTask } = require('../lib/companies/ticker-suggest');

const JOB_ID = 'ticker-recheck';

function isRunning() {
  syncJob(JOB_ID);
  return isJobRunning(JOB_ID);
}

async function fetchFlaggedCompanies({ limit = null, ticker = null } = {}) {
  const params = [];
  const where = [
    `symbol_flagged_at IS NOT NULL`,
    `symbol_fail_count >= ${FAIL_THRESHOLD}`,
    // Skip companies that already have an OPEN suggestion awaiting the VA.
    `id NOT IN (SELECT company_id FROM va_tasks
                 WHERE error_type = 'ticker_suggestion' AND company_id IS NOT NULL
                   AND status IN ('open', 'in_progress'))`,
  ];
  if (ticker) {
    params.push(String(ticker).toUpperCase());
    where.push(`UPPER(ticker) = $${params.length}`);
  }
  let sql = `SELECT id, name, exchange, ticker, symbol_fail_count, market_cap
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

/**
 * @param {object} opts
 * @param {number|null} [opts.limit]
 * @param {string|null} [opts.ticker]
 * @param {boolean} [opts.dryRun]
 */
async function runTickerRecheck(opts = {}) {
  syncJob(JOB_ID);
  if (isRunning()) {
    const err = new Error('Ticker recheck already running');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }
  if (await isAiPaused()) {
    console.log('[ticker-recheck] AI is paused — skipping run.');
    return { skipped: 'ai_paused' };
  }

  const args = {
    limit: opts.limit != null ? Number(opts.limit) : null,
    ticker: opts.ticker || null,
    dryRun: !!opts.dryRun,
    delay: opts.delay != null ? Math.max(0, Number(opts.delay)) : 1500,
  };

  startJob(JOB_ID, { label: 'Ticker recheck (web + AI)', pid: process.pid, type: 'in-process', meta: args });
  const stats = { checked: 0, suggested: 0, noChange: 0, lowConfidence: 0, failed: 0 };

  try {
    const companies = await fetchFlaggedCompanies(args);
    console.log(`[ticker-recheck] ${companies.length} flagged companies to research`);

    for (const c of companies) {
      stats.checked += 1;
      const tag = `[${stats.checked}/${companies.length}] ${c.exchange}:${c.ticker} ${String(c.name).slice(0, 40)}`;
      try {
        const { ok, suggestion, reason } = await suggestTickerForCompany(c);
        if (!ok || !suggestion) {
          if (reason === 'no_search_results' || reason === 'no_change') stats.noChange += 1;
          else stats.failed += 1;
          console.log(`[ticker-recheck] ${tag} — ${reason || 'no suggestion'}`);
        } else if (!suggestion.changed) {
          stats.noChange += 1;
          console.log(`[ticker-recheck] ${tag} — no change (${(suggestion.confidence * 100).toFixed(0)}%)`);
        } else if (args.dryRun) {
          stats.suggested += 1;
          console.log(`[ticker-recheck] ${tag} — WOULD suggest ${suggestion.suggested_tv_symbol} (${(suggestion.confidence * 100).toFixed(0)}%) [dry-run]`);
        } else {
          const res = await createTickerSuggestionTask(c, suggestion);
          if (res.created) {
            stats.suggested += 1;
            console.log(`[ticker-recheck] ${tag} — suggested ${suggestion.suggested_tv_symbol} (${(suggestion.confidence * 100).toFixed(0)}%)`);
          } else {
            if (res.reason === 'low_confidence') stats.lowConfidence += 1;
            else stats.noChange += 1;
            console.log(`[ticker-recheck] ${tag} — not filed (${res.reason})`);
          }
        }
      } catch (err) {
        stats.failed += 1;
        console.warn(`[ticker-recheck] ${tag} — error: ${err.message}`);
      }
      if (args.delay) await new Promise((r) => setTimeout(r, args.delay));
    }

    endJob(JOB_ID, 'completed');
    console.log(`[ticker-recheck] Done: ${JSON.stringify(stats)}`);
    return stats;
  } catch (err) {
    endJob(JOB_ID, 'error');
    throw err;
  }
}

module.exports = { runTickerRecheck, isRunning, JOB_ID };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const opts = {
    limit: getArg('limit'),
    ticker: getArg('ticker'),
    dryRun: argv.includes('--dry-run'),
  };
  runTickerRecheck(opts)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ticker-recheck] Failed:', err?.message || err);
      process.exit(1);
    });
}
