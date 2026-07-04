const db = require('../../db');
const { clearCompanySymbolFlag } = require('../../lib/market/symbol-health');

async function countForCompany(table, column, companyId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS c FROM ${table} WHERE ${column} = $1`,
    [companyId],
  );
  return r.rows[0]?.c || 0;
}

async function getCompanyRow(clientOrPool, id) {
  const r = await clientOrPool.query(
    `SELECT id, name, exchange, ticker, sedar_ticker, symbol_flagged_at, symbol_flagged_reason
       FROM companies WHERE id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

async function previewMigration(sourceId) {
  const source = await getCompanyRow(db, sourceId);
  if (!source) return null;

  const [
    filings,
    newsReleases,
    marketNews,
    discussions,
    people,
    insiderOwnership,
    insiderTransactions,
    snapshots,
    watchlist,
    instrumentSymbols,
  ] = await Promise.all([
    countForCompany('filings', 'company_id', sourceId),
    countForCompany('news_releases', 'company_id', sourceId),
    countForCompany('market_news', 'company_id', sourceId),
    countForCompany('discussions', 'company_id', sourceId),
    countForCompany('company_people', 'company_id', sourceId),
    countForCompany('insider_ownership', 'company_id', sourceId),
    countForCompany('insider_transactions', 'company_id', sourceId),
    countForCompany('company_snapshots', 'company_id', sourceId),
    countForCompany('watchlist', 'company_id', sourceId),
    db.query(
      `SELECT COUNT(*)::int AS c FROM instrument_symbols
        WHERE entity_type = 'company' AND entity_id = $1`,
      [sourceId],
    ).then((r) => r.rows[0]?.c || 0),
  ]);

  return {
    source,
    counts: {
      filings,
      newsReleases,
      marketNews,
      discussions,
      people,
      insiderOwnership,
      insiderTransactions,
      snapshots,
      watchlist,
      instrumentSymbols,
    },
    total:
      filings + newsReleases + marketNews + discussions + people
      + insiderOwnership + insiderTransactions + snapshots + watchlist + instrumentSymbols,
  };
}

/**
 * Move related data from source company → target company.
 * Handles unique-constraint conflicts by keeping the target row.
 */
async function migrateCompanyData(sourceId, targetId, { deleteSource = false } = {}) {
  if (!sourceId || !targetId) throw new Error('sourceId and targetId are required');
  if (sourceId === targetId) throw new Error('Source and target must be different companies');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const source = await getCompanyRow(client, sourceId);
    const target = await getCompanyRow(client, targetId);
    if (!source) throw new Error('Source company not found');
    if (!target) throw new Error('Target company not found');

    const moved = {};

    const filings = await client.query(
      `UPDATE filings
          SET company_id = $2,
              company_name = $3,
              exchange = COALESCE(NULLIF(exchange, ''), $4)
        WHERE company_id = $1`,
      [sourceId, targetId, target.name, target.exchange],
    );
    moved.filings = filings.rowCount || 0;

    const newsReleases = await client.query(
      `UPDATE news_releases
          SET company_id = $2,
              ticker = COALESCE($3, ticker)
        WHERE company_id = $1`,
      [sourceId, targetId, target.ticker],
    );
    moved.newsReleases = newsReleases.rowCount || 0;

    const marketNews = await client.query(
      `UPDATE market_news
          SET company_id = $2,
              ticker = COALESCE($3, ticker)
        WHERE company_id = $1`,
      [sourceId, targetId, target.ticker],
    );
    moved.marketNews = marketNews.rowCount || 0;

    const discussions = await client.query(
      `UPDATE discussions SET company_id = $2 WHERE company_id = $1`,
      [sourceId, targetId],
    );
    moved.discussions = discussions.rowCount || 0;

    // People: skip rows that would violate UNIQUE (company_id, name, kind)
    const people = await client.query(
      `UPDATE company_people p
          SET company_id = $2
        WHERE p.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM company_people t
             WHERE t.company_id = $2 AND t.name = p.name AND t.kind = p.kind
          )`,
      [sourceId, targetId],
    );
    moved.people = people.rowCount || 0;
    await client.query(`DELETE FROM company_people WHERE company_id = $1`, [sourceId]);

    const insiderOwn = await client.query(
      `UPDATE insider_ownership o
          SET company_id = $2
        WHERE o.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM insider_ownership t
             WHERE t.company_id = $2 AND t.insider_name = o.insider_name
          )`,
      [sourceId, targetId],
    );
    moved.insiderOwnership = insiderOwn.rowCount || 0;
    await client.query(`DELETE FROM insider_ownership WHERE company_id = $1`, [sourceId]);

    const insiderTx = await client.query(
      `UPDATE insider_transactions x
          SET company_id = $2
        WHERE x.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM insider_transactions t
             WHERE t.company_id = $2
               AND t.insider_name = x.insider_name
               AND t.transaction_date IS NOT DISTINCT FROM x.transaction_date
               AND t.shares IS NOT DISTINCT FROM x.shares
               AND t.transaction_type IS NOT DISTINCT FROM x.transaction_type
          )`,
      [sourceId, targetId],
    );
    moved.insiderTransactions = insiderTx.rowCount || 0;
    await client.query(`DELETE FROM insider_transactions WHERE company_id = $1`, [sourceId]);

    // Snapshot: move only if target has none
    const snapExists = await client.query(
      `SELECT 1 FROM company_snapshots WHERE company_id = $1`,
      [targetId],
    );
    if (snapExists.rows.length) {
      await client.query(`DELETE FROM company_snapshots WHERE company_id = $1`, [sourceId]);
      moved.snapshots = 0;
    } else {
      const snaps = await client.query(
        `UPDATE company_snapshots SET company_id = $2 WHERE company_id = $1`,
        [sourceId, targetId],
      );
      moved.snapshots = snaps.rowCount || 0;
    }

    // Watchlist: if user already watches target, drop source row; else re-point company_id
    await client.query(
      `DELETE FROM watchlist w
        WHERE w.company_id = $1
          AND EXISTS (
            SELECT 1 FROM watchlist t
             WHERE t.user_id = w.user_id
               AND t.item_type = 'company'
               AND t.company_id = $2
          )`,
      [sourceId, targetId],
    );
    const watch = await client.query(
      `UPDATE watchlist SET company_id = $2 WHERE company_id = $1`,
      [sourceId, targetId],
    );
    moved.watchlist = watch.rowCount || 0;

    // Instrument symbols: skip tv_symbol already on target
    const symbols = await client.query(
      `UPDATE instrument_symbols s
          SET entity_id = $2
        WHERE s.entity_type = 'company'
          AND s.entity_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM instrument_symbols t
             WHERE t.entity_type = 'company'
               AND t.entity_id = $2
               AND t.tv_symbol = s.tv_symbol
          )`,
      [sourceId, targetId],
    );
    moved.instrumentSymbols = symbols.rowCount || 0;
    await client.query(
      `DELETE FROM instrument_symbols
        WHERE entity_type = 'company' AND entity_id = $1`,
      [sourceId],
    );

    // Clear flag on source (and resolve per-company VA task if present)
    await client.query(
      `UPDATE companies SET
         symbol_flagged_at = NULL,
         symbol_flagged_reason = NULL,
         symbol_flagged_tv_symbol = NULL,
         updated_at = NOW()
       WHERE id = $1`,
      [sourceId],
    );

    if (deleteSource) {
      await client.query(`DELETE FROM companies WHERE id = $1`, [sourceId]);
    }

    await client.query('COMMIT');

    // Best-effort VA task cleanup (flag already cleared in-transaction)
    if (!deleteSource) {
      try {
        await clearCompanySymbolFlag(sourceId);
      } catch {
        /* ignore */
      }
    } else {
      try {
        const { resolveAutoTask } = require('../infra/va-tasks-sync');
        await resolveAutoTask(`companies|symbol_invalid|${sourceId}`);
      } catch {
        /* ignore */
      }
    }

    return {
      source: { id: source.id, name: source.name, ticker: source.ticker, exchange: source.exchange },
      target: { id: target.id, name: target.name, ticker: target.ticker, exchange: target.exchange },
      moved,
      deletedSource: !!deleteSource,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  previewMigration,
  migrateCompanyData,
};
