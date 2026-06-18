const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  fetchAndStoreRssFeeds,
  fetchCompanyNews,
  drainUnprocessedNews,
  companyCategoryKey,
} = require('../lib/news-fetch');

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

/** Match frontend getNewsSeverity buckets for SQL filtering */
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

router.get('/feed', async (req, res) => {
  try {
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 12;
    const offset = (page - 1) * limit;

    // origin filter: 'google' = Market News (Google News), 'rss' = News Releases
    // (scheduled feeds). Anything else returns the full feed.
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

    let originClause = '';
    const filterParams = [];
    if (origin === 'google') {
      originClause = ` AND n.origin = $${filterParams.length + 1}`;
      filterParams.push('google');
    } else if (origin === 'rss') {
      originClause = ` AND COALESCE(n.origin, 'rss') <> $${filterParams.length + 1}`;
      filterParams.push('google');
    }

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

    const baseFrom = `FROM news n LEFT JOIN companies c ON c.id = n.company_id`;
    const baseWhere = `WHERE n.relevant = TRUE${originClause}${extraClause}`;

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

    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items: itemsResult.rows.map(formatRow),
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
    const companyIdRaw = parseInt(req.query.companyId, 10);
    const companyId = Number.isFinite(companyIdRaw) && companyIdRaw > 0 ? companyIdRaw : null;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const categoryByName = companyCategoryKey(companyName);
    const legacyCategoryByTicker = ticker ? `company:${ticker}` : null;

    const fetchLimit = limit + 1;
    const sql = `
      SELECT n.*, c.name AS company_name, c.exchange AS company_exchange
      FROM news n
      LEFT JOIN companies c ON c.id = n.company_id
      WHERE n.relevant = TRUE
        AND (
          n.category = $1
          OR ($2::text IS NOT NULL AND n.category = $2)
          OR ($3::int IS NOT NULL AND n.company_id = $3)
          OR ($4::text <> '' AND c.name ILIKE $4)
        )
      ORDER BY n.pub_date DESC
      LIMIT $5 OFFSET $6`;

    const nameMatch = companyName ? companyName : null;
    let result = await db.query(sql, [
      categoryByName,
      legacyCategoryByTicker,
      companyId,
      nameMatch,
      fetchLimit,
      offset,
    ]);

    if (result.rows.length === 0 && offset === 0) {
      await fetchCompanyNews(companyName, ticker, companyId);
      result = await db.query(sql, [
        categoryByName,
        legacyCategoryByTicker,
        companyId,
        nameMatch,
        fetchLimit,
        offset,
      ]);
    }

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(formatRow);
    res.json({ items, hasMore, nextOffset: hasMore ? offset + limit : null });
  } catch (err) {
    console.error('Company news query failed:', err?.message || err);
    res.status(503).json({ items: [], hasMore: false, nextOffset: null });
  }
});

router.get('/item', async (req, res) => {
  try {
    const link = (req.query.link || '').toString().trim();
    const id = parseInt(req.query.id, 10);
    let result;
    if (Number.isFinite(id) && id > 0) {
      result = await db.query(`SELECT * FROM news WHERE id = $1 LIMIT 1`, [id]);
    } else if (link) {
      result = await db.query(`SELECT * FROM news WHERE link = $1 LIMIT 1`, [link]);
    } else {
      return res.status(400).json({ error: 'link or id required' });
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ item: formatRow(result.rows[0]) });
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
