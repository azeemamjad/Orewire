/**
 * Shared schema + helpers for news_releases and market_news tables.
 */

const TABLE_RELEASES = 'news_releases';
const TABLE_MARKET = 'market_news';

const NEWS_ROW_COLUMNS = [
  'title', 'link', 'source', 'pub_date', 'description', 'summary',
  'commodity', 'sentiment', 'relevant', 'ai_processed', 'company_id',
  'ticker', 'category', 'created_at',
];

const NEWS_SELECT_COLUMNS = [
  'id', 'title', 'link', 'source', 'pub_date', 'description', 'summary',
  'commodity', 'sentiment', 'relevant', 'ai_processed', 'company_id',
  'ticker', 'category', 'created_at',
].join(', ');

function tableForOrigin(origin) {
  return String(origin || '').toLowerCase() === 'google' ? TABLE_MARKET : TABLE_RELEASES;
}

function sourceForTable(table) {
  return table === TABLE_MARKET ? 'market' : 'release';
}

function tableForSource(source) {
  return source === 'market' ? TABLE_MARKET : TABLE_RELEASES;
}

/** SQL fragment: severity filter (alias `n`). */
function severityClause(severity) {
  const s = String(severity || '').toLowerCase();
  if (!s || s === 'all') return '';
  if (s === 'critical') {
    return ` AND (
      LOWER(n.title) LIKE '%drill%'
      AND (LOWER(n.title) LIKE '%high-grade%' OR n.title ~* '\\d+.*g/t')
    )`;
  }
  if (s === 'high') {
    return ` AND (
      LOWER(n.title) LIKE '%resource%'
      OR LOWER(n.title) LIKE '%feasibility%'
      OR LOWER(n.title) LIKE '%assay%'
      OR n.sentiment = 'bullish'
    )`;
  }
  if (s === 'medium') {
    return ` AND (
      LOWER(n.title) LIKE '%placement%'
      OR LOWER(n.title) LIKE '%financing%'
      OR LOWER(n.title) LIKE '%acquisition%'
      OR n.sentiment = 'bearish'
    )`;
  }
  if (s === 'low') {
    return ` AND NOT (
      (LOWER(n.title) LIKE '%drill%' AND (LOWER(n.title) LIKE '%high-grade%' OR n.title ~* '\\d+.*g/t'))
      OR LOWER(n.title) LIKE '%resource%'
      OR LOWER(n.title) LIKE '%feasibility%'
      OR LOWER(n.title) LIKE '%assay%'
      OR n.sentiment = 'bullish'
      OR LOWER(n.title) LIKE '%placement%'
      OR LOWER(n.title) LIKE '%financing%'
      OR LOWER(n.title) LIKE '%acquisition%'
      OR n.sentiment = 'bearish'
    )`;
  }
  return '';
}

function exchangeMatchSql(paramIdx) {
  return `REPLACE(UPPER(COALESCE(c.exchange, '')), '-', '') = REPLACE(UPPER($${paramIdx}), '-', '')`;
}

function buildFeedFilters({
  companyLinked,
  companyId,
  exchange,
  search,
  commodity,
  sentiment,
  severity,
  filterParams,
}) {
  let extraClause = '';
  if (companyLinked) extraClause += ' AND n.company_id IS NOT NULL';
  if (companyId) {
    filterParams.push(companyId);
    extraClause += ` AND n.company_id = $${filterParams.length}`;
  }
  if (exchange && exchange.toLowerCase() !== 'all') {
    filterParams.push(exchange);
    extraClause += ` AND ${exchangeMatchSql(filterParams.length)}`;
  }
  if (search) {
    filterParams.push(`%${search}%`);
    const i = filterParams.length;
    extraClause += ` AND (n.title ILIKE $${i} OR n.summary ILIKE $${i} OR n.description ILIKE $${i} OR c.name ILIKE $${i} OR c.ticker ILIKE $${i})`;
  }
  if (commodity && commodity.toLowerCase() !== 'all') {
    filterParams.push(commodity);
    extraClause += ` AND n.commodity = $${filterParams.length}`;
  }
  if (sentiment && ['bullish', 'bearish', 'neutral'].includes(sentiment)) {
    filterParams.push(sentiment);
    extraClause += ` AND n.sentiment = $${filterParams.length}`;
  }
  extraClause += severityClause(severity);
  return extraClause;
}

async function migrateLegacyNewsTable(db, safeQuery) {
  const legacy = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'news'
    ) AS exists
  `);
  if (!legacy.rows[0]?.exists) return;

  const [{ rows: [{ n: newsCount }] }, { rows: [{ n: releaseCount }] }] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n FROM news'),
    db.query('SELECT COUNT(*)::int AS n FROM news_releases'),
  ]);

  if (newsCount > 0 && releaseCount === 0) {
    await db.query(`
      INSERT INTO news_releases (
        id, title, link, source, pub_date, description, summary, commodity,
        sentiment, relevant, ai_processed, company_id, ticker, category, created_at
      )
      SELECT
        id, title, link, source, pub_date, description, summary, commodity,
        sentiment, relevant, ai_processed, company_id, ticker, category, created_at
      FROM news
      WHERE COALESCE(origin, 'rss') <> 'google'
      ON CONFLICT (link) DO NOTHING
    `);

    await db.query(`
      INSERT INTO market_news (
        id, title, link, source, pub_date, description, summary, commodity,
        sentiment, relevant, ai_processed, company_id, ticker, category, created_at
      )
      SELECT
        id, title, link, source, pub_date, description, summary, commodity,
        sentiment, relevant, ai_processed, company_id, ticker, category, created_at
      FROM news
      WHERE origin = 'google'
      ON CONFLICT (link) DO NOTHING
    `);

    await safeQuery(`
      SELECT setval(
        pg_get_serial_sequence('news_releases', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM news_releases), 1), 1)
      )
    `);
    await safeQuery(`
      SELECT setval(
        pg_get_serial_sequence('market_news', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM market_news), 1), 1)
      )
    `);

    console.log('[DB] Copied legacy news rows into news_releases + market_news');
  }

  const sentCols = await db.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'watchlist_news_email_sent'
  `);
  const colNames = sentCols.rows.map((r) => r.column_name);

  if (colNames.includes('news_id') && !colNames.includes('source')) {
    await db.query(`
      CREATE TABLE watchlist_news_email_sent_new (
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source   TEXT NOT NULL CHECK (source IN ('release', 'market')),
        item_id  INTEGER NOT NULL,
        sent_at  TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, source, item_id)
      )
    `);
    await db.query(`
      INSERT INTO watchlist_news_email_sent_new (user_id, source, item_id, sent_at)
      SELECT s.user_id,
             CASE WHEN COALESCE(n.origin, 'rss') = 'google' THEN 'market' ELSE 'release' END,
             s.news_id,
             s.sent_at
        FROM watchlist_news_email_sent s
        INNER JOIN news n ON n.id = s.news_id
      ON CONFLICT DO NOTHING
    `);
    await db.query('DROP TABLE watchlist_news_email_sent');
    await db.query('ALTER TABLE watchlist_news_email_sent_new RENAME TO watchlist_news_email_sent');
    await safeQuery('CREATE INDEX IF NOT EXISTS idx_watchlist_news_sent_item ON watchlist_news_email_sent(source, item_id)');
    console.log('[DB] Migrated watchlist_news_email_sent to source + item_id');
  }

  await safeQuery('DROP TABLE IF EXISTS news CASCADE');
  console.log('[DB] Dropped legacy news table');
}

module.exports = {
  TABLE_RELEASES,
  TABLE_MARKET,
  NEWS_ROW_COLUMNS,
  NEWS_SELECT_COLUMNS,
  tableForOrigin,
  sourceForTable,
  tableForSource,
  severityClause,
  exchangeMatchSql,
  buildFeedFilters,
  migrateLegacyNewsTable,
};
