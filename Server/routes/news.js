const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  fetchAndStoreRssFeeds,
  drainUnprocessedNews,
} = require('../lib/news-fetch');
const {
  TABLE_RELEASES,
  TABLE_MARKET,
  buildFeedFilters,
} = require('../lib/news-db');
const {
  OFFICIAL_RELEASE_SOURCES,
  syncOfficialCompanyReleases,
} = require('../lib/official-news-releases');

let fetchRunning = false;

async function fetchAndStoreNews() {
  if (fetchRunning) return;
  fetchRunning = true;
  try {
    const stats = await fetchAndStoreRssFeeds();
    if (stats.inserted > 0) {
      console.log(
        `[News] Fetched ${stats.total} items, inserted ${stats.inserted} new (${stats.matched} matched to companies), running AI enrichment`
      );
    }
    drainUnprocessedNews().catch((err) => {
      console.error('[News] Backlog enrichment failed:', err?.message || err);
    });
  } catch (err) {
    console.error('[News] Fetch cycle failed:', err?.message || err);
  } finally {
    fetchRunning = false;
  }
}

const FETCH_INTERVAL = 5 * 60 * 1000;
setTimeout(() => fetchAndStoreNews(), 5000);
setInterval(() => fetchAndStoreNews(), FETCH_INTERVAL);

/** e.g. Apr 24 · 7:31 AM (exchange-local style timestamp for news rows) */
function formatPubDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const tz = process.env.TIMEZONE || 'America/Toronto';
  const datePart = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart} · ${timePart}`;
}

function normalizeExchange(ex) {
  if (!ex) return null;
  const upper = String(ex).toUpperCase();
  if (upper === 'TSX') return 'TSX';
  if (upper.includes('TSXV') || upper.includes('TSX-V')) return 'TSX-V';
  if (upper.includes('CSE')) return 'CSE';
  if (upper.includes('ASX')) return 'ASX';
  return ex;
}

function formatRow(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || row.description || '',
    description: row.description && row.description !== row.summary ? row.description : null,
    source: row.source || 'News',
    link: row.link,
    pubDate: row.pub_date,
    timeAgo: formatPubDateTime(row.pub_date),
    commodity: row.commodity || null,
    sentiment: row.sentiment || 'neutral',
    ticker: row.ticker || null,
    companyId: row.company_id || null,
    company: row.company_name || null,
    exchange: normalizeExchange(row.company_exchange),
  };
}

function tableForFeedOrigin(origin) {
  const o = String(origin || '').toLowerCase();
  if (o === 'google') return TABLE_MARKET;
  if (o === 'rss') return TABLE_RELEASES;
  return null;
}

async function queryFeedTable(table, { filterParams, extraClause, limit, offset }) {
  const baseFrom = `FROM ${table} n LEFT JOIN companies c ON c.id = n.company_id`;
  const baseWhere = `WHERE n.relevant = TRUE${extraClause}`;

  const [itemsResult, countResult] = await Promise.all([
    db.query(
      `SELECT n.*, c.name AS company_name, c.exchange AS company_exchange
       ${baseFrom}
       ${baseWhere}
       ORDER BY n.pub_date DESC
       LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
      [...filterParams, limit, offset],
    ),
    db.query(
      `SELECT COUNT(*)::int AS total ${baseFrom} ${baseWhere}`,
      filterParams,
    ),
  ]);

  return {
    items: itemsResult.rows.map(formatRow),
    total: countResult.rows[0]?.total || 0,
  };
}

async function queryCombinedFeed({ filterParams, extraClause, limit, offset }) {
  const unionSql = `
    SELECT n.id, n.title, n.link, n.source, n.pub_date, n.description, n.summary,
           n.commodity, n.sentiment, n.relevant, n.ai_processed, n.company_id, n.ticker,
           n.category, n.created_at, c.name AS company_name, c.exchange AS company_exchange
      FROM ${TABLE_RELEASES} n
      LEFT JOIN companies c ON c.id = n.company_id
     WHERE n.relevant = TRUE${extraClause}
    UNION ALL
    SELECT n.id, n.title, n.link, n.source, n.pub_date, n.description, n.summary,
           n.commodity, n.sentiment, n.relevant, n.ai_processed, n.company_id, n.ticker,
           n.category, n.created_at, c.name AS company_name, c.exchange AS company_exchange
      FROM ${TABLE_MARKET} n
      LEFT JOIN companies c ON c.id = n.company_id
     WHERE n.relevant = TRUE${extraClause}
  `;

  const [itemsResult, countResult] = await Promise.all([
    db.query(
      `SELECT * FROM (${unionSql}) combined
       ORDER BY pub_date DESC
       LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
      [...filterParams, limit, offset],
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM (${unionSql}) combined`,
      filterParams,
    ),
  ]);

  return {
    items: itemsResult.rows.map(formatRow),
    total: countResult.rows[0]?.total || 0,
  };
}

router.get('/feed', async (req, res) => {
  try {
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 12;
    const offset = (page - 1) * limit;

    const origin = (req.query.origin || '').toString().trim().toLowerCase();
    const companyLinked = ['1', 'true', 'yes'].includes(
      String(req.query.companyLinked || '').toLowerCase(),
    );
    const companyIdRaw = parseInt(req.query.companyId, 10);
    const companyId = Number.isFinite(companyIdRaw) && companyIdRaw > 0 ? companyIdRaw : null;
    const exchange = (req.query.exchange || '').toString().trim();
    const search = (req.query.search || '').toString().trim();
    const commodity = (req.query.commodity || '').toString().trim();
    const sentiment = (req.query.sentiment || '').toString().trim().toLowerCase();
    const severity = (req.query.severity || '').toString().trim();

    const filterParams = [];
    const extraClause = buildFeedFilters({
      companyLinked,
      companyId,
      exchange,
      search,
      commodity,
      sentiment,
      severity,
      filterParams,
    });

    let releaseClause = extraClause;
    if (origin === 'rss') {
      filterParams.push(OFFICIAL_RELEASE_SOURCES);
      releaseClause += ` AND n.source = ANY($${filterParams.length}::text[])`;
    }

    const table = tableForFeedOrigin(origin);
    const result = table
      ? await queryFeedTable(table, { filterParams, extraClause: releaseClause, limit, offset })
      : await queryCombinedFeed({ filterParams, extraClause: releaseClause, limit, offset });

    const total = result.total;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items: result.items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error('News feed query failed:', err?.message || err);
    res.status(503).json({
      items: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 1, hasNext: false, hasPrev: false },
    });
  }
});

router.get('/company/:name', async (req, res) => {
  try {
    const companyName = decodeURIComponent(req.params.name).trim();
    const ticker = (req.query.ticker || '').trim();
    const exchange = (req.query.exchange || '').trim();
    const companyIdRaw = parseInt(req.query.companyId, 10);
    const companyId = Number.isFinite(companyIdRaw) && companyIdRaw > 0 ? companyIdRaw : null;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const fetchLimit = limit + 1;
    const nameMatch = companyName ? `%${companyName}%` : null;

    const runQuery = () => db.query(
      `SELECT n.*, c.name AS company_name, c.exchange AS company_exchange
         FROM ${TABLE_RELEASES} n
         LEFT JOIN companies c ON c.id = n.company_id
        WHERE n.relevant = TRUE
          AND n.source = ANY($1::text[])
          AND (
            ($2::int IS NOT NULL AND n.company_id = $2)
            OR ($3::text IS NOT NULL AND c.name ILIKE $3)
          )
        ORDER BY n.pub_date DESC
        LIMIT $4 OFFSET $5`,
      [OFFICIAL_RELEASE_SOURCES, companyId, nameMatch, fetchLimit, offset],
    );

    let result = await runQuery();

    if (result.rows.length === 0 && offset === 0 && companyId) {
      await syncOfficialCompanyReleases({
        name: companyName,
        ticker,
        exchange,
        companyId,
      });
      result = await runQuery();
    }

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(formatRow);
    res.json({ items, hasMore, nextOffset: hasMore ? offset + limit : null });
  } catch (err) {
    console.error('Company news query failed:', err?.message || err);
    res.status(503).json({ items: [], hasMore: false, nextOffset: null });
  }
});

async function findNewsItem({ id, link }) {
  if (Number.isFinite(id) && id > 0) {
    for (const table of [TABLE_RELEASES, TABLE_MARKET]) {
      const result = await db.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
      if (result.rows.length) return result.rows[0];
    }
    return null;
  }
  if (link) {
    for (const table of [TABLE_RELEASES, TABLE_MARKET]) {
      const result = await db.query(`SELECT * FROM ${table} WHERE link = $1 LIMIT 1`, [link]);
      if (result.rows.length) return result.rows[0];
    }
  }
  return null;
}

router.get('/item', async (req, res) => {
  try {
    const link = (req.query.link || '').toString().trim();
    const id = parseInt(req.query.id, 10);
    if (!link && !(Number.isFinite(id) && id > 0)) {
      return res.status(400).json({ error: 'link or id required' });
    }

    const row = await findNewsItem({ id, link });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ item: formatRow(row) });
  } catch (err) {
    console.error('News item query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

router.post('/refresh', async (req, res) => {
  fetchAndStoreNews();
  res.json({ ok: true, message: 'News fetch triggered' });
});

module.exports = router;
