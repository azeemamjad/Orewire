const db = require('../../db');

const HOURS_24_MS = 24 * 60 * 60 * 1000;
const DEDUPE_DAYS = 14;

function fmtExchange(ex) {
  if (!ex) return '';
  const u = String(ex).toUpperCase();
  if (u === 'TSXV') return 'TSX-V';
  return ex;
}

function appBase() {
  return (process.env.APP_URL || `https://${(process.env.FRONTEND_DOMAIN || 'orewire.com').replace(/^https?:\/\//, '')}`).replace(/\/$/, '');
}

async function recentSourceKeys() {
  const r = await db.query(
    `SELECT kind, source_id FROM social_post_items
      WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')
        AND source_id IS NOT NULL`,
    [DEDUPE_DAYS],
  );
  return new Set(r.rows.map((row) => `${row.kind}:${row.source_id}`));
}

async function fetchFilingCandidates(since, limit = 20) {
  const r = await db.query(
    `SELECT f.id, f.company_name, f.filing_type, f.created_at,
            COALESCE(NULLIF(f.exchange, ''), c.exchange) AS exchange,
            c.ticker,
            a.verdict, a.ticker_summary, a.summary, a.verdict_reason
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
       LEFT JOIN companies c ON c.id = f.company_id
      WHERE f.created_at > $1
        AND LOWER(COALESCE(a.verdict, '')) IN ('noteworthy', 'watch')
      ORDER BY
        CASE LOWER(COALESCE(a.verdict, ''))
          WHEN 'noteworthy' THEN 0
          WHEN 'watch' THEN 1
          ELSE 2
        END,
        f.created_at DESC
      LIMIT $2`,
    [since, limit],
  );
  const base = appBase();
  return r.rows.map((row) => {
    const summary = (row.ticker_summary || row.summary || row.verdict_reason || '').trim();
    const ticker = (row.ticker || '').toUpperCase();
    const exchange = fmtExchange(row.exchange);
    return {
      kind: 'filing',
      sourceId: String(row.id),
      ticker,
      exchange,
      companyName: row.company_name,
      verdict: row.verdict,
      summary,
      href: `${base}/filings/${row.id}`,
      label: ticker ? `$${ticker}${exchange ? ` (${exchange})` : ''}` : (row.company_name || 'Filing'),
    };
  });
}

async function fetchNewsCandidates(since, limit = 20) {
  const r = await db.query(
    `SELECT n.id, n.title, n.summary, n.ticker, n.link, n.pub_date,
            c.name AS company_name, c.exchange, c.ticker AS company_ticker
       FROM news_releases n
       LEFT JOIN companies c ON (
         n.company_id = c.id
         OR UPPER(COALESCE(n.ticker, '')) = UPPER(COALESCE(c.ticker, ''))
       )
      WHERE n.relevant = TRUE
        AND GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) > $1
        AND COALESCE(NULLIF(TRIM(n.summary), ''), '') <> ''
      ORDER BY GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) DESC
      LIMIT $2`,
    [since, limit],
  );
  const base = appBase();
  return r.rows.map((row) => {
    const ticker = (row.company_ticker || row.ticker || '').toUpperCase();
    const exchange = fmtExchange(row.exchange);
    const summary = (row.summary || row.title || '').trim();
    return {
      kind: 'news',
      sourceId: String(row.id),
      ticker,
      exchange,
      companyName: row.company_name,
      summary,
      title: row.title,
      href: row.link ? `${base}/news/${encodeURIComponent(row.link)}` : `${base}/news`,
      label: ticker ? `$${ticker}${exchange ? ` (${exchange})` : ''}` : (row.company_name || 'News'),
    };
  });
}

/**
 * Pick 5–7 briefing-style items (noteworthy/watch filings + AI news),
 * skipping anything posted in the last 14 days.
 */
async function selectThreadItems({ itemsMin = 5, itemsMax = 7 } = {}) {
  const since = new Date(Date.now() - HOURS_24_MS);
  const seen = await recentSourceKeys();
  const [filings, news] = await Promise.all([
    fetchFilingCandidates(since, 30),
    fetchNewsCandidates(since, 30),
  ]);

  const out = [];
  const push = (item) => {
    const key = `${item.kind}:${item.sourceId}`;
    if (seen.has(key)) return;
    if (!item.summary) return;
    seen.add(key);
    out.push(item);
  };

  // Prefer filings first (noteworthy already sorted ahead of watch), then fill with news
  for (const f of filings) {
    if (out.length >= itemsMax) break;
    push(f);
  }
  for (const n of news) {
    if (out.length >= itemsMax) break;
    push(n);
  }

  // If still short, allow routine/any filings without verdict filter
  if (out.length < itemsMin) {
    const extra = await db.query(
      `SELECT f.id, f.company_name,
              COALESCE(NULLIF(f.exchange, ''), c.exchange) AS exchange,
              c.ticker,
              a.ticker_summary, a.summary, a.verdict_reason
         FROM filings f
         LEFT JOIN ai_output a ON a.filing_id = f.id
         LEFT JOIN companies c ON c.id = f.company_id
        WHERE f.created_at > $1
        ORDER BY f.created_at DESC
        LIMIT 20`,
      [since],
    );
    const base = appBase();
    for (const row of extra.rows) {
      if (out.length >= itemsMin) break;
      const summary = (row.ticker_summary || row.summary || row.verdict_reason || '').trim();
      if (!summary) continue;
      const ticker = (row.ticker || '').toUpperCase();
      const exchange = fmtExchange(row.exchange);
      push({
        kind: 'filing',
        sourceId: String(row.id),
        ticker,
        exchange,
        companyName: row.company_name,
        summary,
        href: `${base}/filings/${row.id}`,
        label: ticker ? `$${ticker}${exchange ? ` (${exchange})` : ''}` : (row.company_name || 'Filing'),
      });
    }
  }

  return out.slice(0, itemsMax);
}

module.exports = { selectThreadItems, appBase };
