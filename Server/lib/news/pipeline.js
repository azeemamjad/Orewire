const db = require('../../db');
const { addLog } = require('../../pipeline/state');
const { fetchCompanyNews } = require('./fetch');

let running = false;

/**
 * For each company with a ticker: fetch news releases; skip AI if nothing new.
 */
async function runNewsPipeline() {
  if (running) {
    addLog('warn', '[News Pipeline] Already running — skipping');
    return { skipped: true };
  }

  running = true;
  const stats = { companies: 0, withNew: 0, skipped: 0, inserted: 0, enriched: 0, errors: 0 };

  try {
    addLog('out', '[News Pipeline] Starting per-company news fetch…');
    const result = await db.query(
      `SELECT id, name, ticker FROM companies WHERE ticker IS NOT NULL AND TRIM(ticker) <> '' ORDER BY name`
    );
    stats.companies = result.rows.length;

    for (const row of result.rows) {
      try {
        const { inserted, enriched } = await fetchCompanyNews(row.name, row.ticker, row.id, {
          skipCooldown: true,
        });

        if (inserted === 0) {
          stats.skipped++;
          continue;
        }

        stats.withNew++;
        stats.inserted += inserted;
        stats.enriched += enriched || 0;
        addLog('out', `[News Pipeline] ${row.ticker}: ${inserted} new, ${enriched || 0} enriched`);
      } catch (err) {
        stats.errors++;
        addLog('err', `[News Pipeline] ${row.ticker || row.name}: ${err.message}`);
      }
    }

    addLog(
      'out',
      `[News Pipeline] Done — ${stats.companies} companies, ${stats.withNew} with new articles, ${stats.skipped} skipped (no news), ${stats.inserted} inserted, ${stats.enriched} AI-enriched, ${stats.errors} errors`
    );

    // Official ASX / TMX Newsfile releases power the public /news page and
    // company tabs. They used to sync only on first visit, which froze the
    // feed; keep them fresh on a per-company cooldown instead.
    try {
      const { runOfficialReleasesSync } = require('./official-releases');
      await runOfficialReleasesSync({ asxDelayMs: 600, canadianDelayMs: 3000 });
    } catch (err) {
      addLog('err', `[News Pipeline] Official releases sync failed: ${err.message}`);
    }
  } catch (err) {
    addLog('err', `[News Pipeline] Fatal: ${err.message}`);
    stats.errors++;
  } finally {
    running = false;
  }

  return stats;
}

function isNewsPipelineRunning() {
  return running;
}

module.exports = { runNewsPipeline, isNewsPipelineRunning };
