/**
 * Blocked market-news publishers (exact match on market_news.source).
 * Blocked sources are hidden from the public platform; admin can still list them.
 */

const db = require('../../db');

const TABLE = 'market_news_blocked_sources';

/** SQL: exclude rows whose publisher is in the blocklist (alias `n`). */
function blockedMarketSourcesClause(alias = 'n') {
  return ` AND NOT EXISTS (
    SELECT 1 FROM ${TABLE} b
     WHERE b.source IS NOT DISTINCT FROM ${alias}.source
  )`;
}

async function isMarketSourceBlocked(source) {
  const s = String(source || '').trim();
  if (!s) return false;
  const r = await db.query(`SELECT 1 FROM ${TABLE} WHERE source = $1 LIMIT 1`, [s]);
  return r.rows.length > 0;
}

async function blockMarketSource(source, { blockedBy = null, note = null } = {}) {
  const s = String(source || '').trim();
  if (!s) throw new Error('source is required');
  // Ensure table exists even if migrate hasn't run yet on this instance.
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      source     TEXT PRIMARY KEY,
      blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      blocked_by TEXT,
      note       TEXT
    )
  `);
  await db.query(
    `INSERT INTO ${TABLE} (source, blocked_at, blocked_by, note)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (source) DO UPDATE
       SET blocked_at = NOW(),
           blocked_by = COALESCE(EXCLUDED.blocked_by, ${TABLE}.blocked_by),
           note = COALESCE(EXCLUDED.note, ${TABLE}.note)`,
    [s, blockedBy || null, note || null],
  );
  return { source: s, blocked: true };
}

async function unblockMarketSource(source) {
  const s = String(source || '').trim();
  if (!s) throw new Error('source is required');
  const r = await db.query(`DELETE FROM ${TABLE} WHERE source = $1 RETURNING source`, [s]);
  return { source: s, blocked: false, removed: (r.rowCount || 0) > 0 };
}

/**
 * Paginated publisher list from market_news, with blocked status.
 * @param {{ search?: string, filter?: 'all'|'blocked'|'active', page?: number, limit?: number }} opts
 */
async function listMarketSources({ search = '', filter = 'all', page = 1, limit = 25 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * lim;
  const params = [];
  const where = [];

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    where.push(`s.source ILIKE $${params.length}`);
  }
  if (filter === 'blocked') {
    where.push('s.blocked_at IS NOT NULL');
  } else if (filter === 'active') {
    where.push('s.blocked_at IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const base = `
    FROM (
      SELECT n.source,
             COUNT(*)::int AS item_count,
             MAX(n.pub_date) AS last_pub_date,
             b.blocked_at,
             b.blocked_by,
             b.note
        FROM market_news n
        LEFT JOIN ${TABLE} b ON b.source IS NOT DISTINCT FROM n.source
       WHERE n.source IS NOT NULL AND TRIM(n.source) <> ''
       GROUP BY n.source, b.blocked_at, b.blocked_by, b.note
    ) s
    ${whereSql}
  `;

  const [itemsResult, countResult] = await Promise.all([
    db.query(
      `SELECT s.source, s.item_count, s.last_pub_date, s.blocked_at, s.blocked_by, s.note,
              (s.blocked_at IS NOT NULL) AS blocked
         ${base}
        ORDER BY s.item_count DESC, s.source ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total ${base}`, params),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / lim));

  return {
    items: itemsResult.rows.map((row) => ({
      source: row.source,
      itemCount: row.item_count,
      lastPubDate: row.last_pub_date,
      blocked: !!row.blocked,
      blockedAt: row.blocked_at || null,
      blockedBy: row.blocked_by || null,
      note: row.note || null,
    })),
    pagination: {
      page: p,
      limit: lim,
      total,
      totalPages,
      hasNext: p < totalPages,
      hasPrev: p > 1,
    },
  };
}

/**
 * Paginated market_news rows for one publisher (admin; includes blocked sources).
 */
async function listMarketNewsForSource(source, { page = 1, limit = 25, search = '' } = {}) {
  const s = String(source || '').trim();
  if (!s) throw new Error('source is required');

  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * lim;
  const params = [s];
  let where = 'WHERE n.source = $1';

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    where += ` AND (n.title ILIKE $${params.length} OR n.description ILIKE $${params.length} OR n.summary ILIKE $${params.length})`;
  }

  const [itemsResult, countResult, blockedResult] = await Promise.all([
    db.query(
      `SELECT n.id, n.title, n.link, n.source, n.pub_date, n.description, n.summary,
              n.commodity, n.sentiment, n.ticker, n.company_id, n.relevant,
              c.name AS company_name, c.exchange AS company_exchange
         FROM market_news n
         LEFT JOIN companies c ON c.id = n.company_id
         ${where}
        ORDER BY n.pub_date DESC NULLS LAST, n.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM market_news n ${where}`, params),
    db.query(`SELECT blocked_at, blocked_by, note FROM ${TABLE} WHERE source = $1`, [s]),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / lim));
  const blockedRow = blockedResult.rows[0] || null;

  return {
    source: s,
    blocked: !!blockedRow,
    blockedAt: blockedRow?.blocked_at || null,
    blockedBy: blockedRow?.blocked_by || null,
    note: blockedRow?.note || null,
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      link: row.link,
      source: row.source,
      pubDate: row.pub_date,
      description: row.description || null,
      summary: row.summary || null,
      commodity: row.commodity || null,
      sentiment: row.sentiment || null,
      ticker: row.ticker || null,
      companyId: row.company_id || null,
      company: row.company_name || null,
      exchange: row.company_exchange || null,
      relevant: row.relevant !== false,
    })),
    pagination: {
      page: p,
      limit: lim,
      total,
      totalPages,
      hasNext: p < totalPages,
      hasPrev: p > 1,
    },
  };
}

module.exports = {
  TABLE,
  blockedMarketSourcesClause,
  isMarketSourceBlocked,
  blockMarketSource,
  unblockMarketSource,
  listMarketSources,
  listMarketNewsForSource,
};
