const db = require('../db');
const {
  getCommoditiesPayload,
  getIndexesPayload,
  getCurrenciesPayload,
} = require('../routes/market');

const HOURS_24_MS = 24 * 60 * 60 * 1000;

function companySlug(exchange, ticker) {
  const ex = (exchange || '').toUpperCase().replace('-', '');
  const tk = (ticker || '').toUpperCase();
  if (ex && tk) return `${ex}-${tk}`;
  return tk || 'unknown';
}

function fmtExchange(ex) {
  if (!ex) return '';
  const u = ex.toUpperCase();
  if (u === 'TSXV') return 'TSX-V';
  return ex;
}

function filingHref(id) {
  const base = (process.env.APP_URL || `https://${(process.env.FRONTEND_DOMAIN || 'orewire.com').replace(/^https?:\/\//, '')}`).replace(/\/$/, '');
  return `${base}/filings/${id}`;
}

function enrichFiling(row) {
  const verdict = row.verdict
    ? row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1).toLowerCase()
    : null;
  const summary = (row.summary || row.verdict_reason || '').trim();
  return {
    id: row.id,
    companyName: row.company_name,
    ticker: row.ticker,
    exchange: row.exchange,
    exchangeLabel: fmtExchange(row.exchange),
    filingType: row.filing_type || 'Filing',
    verdict,
    summary,
    summaryShort: summary.length > 160 ? `${summary.slice(0, 157)}…` : summary,
    href: filingHref(row.id),
    slugLabel: `${fmtExchange(row.exchange)}: ${row.ticker || '—'}`,
  };
}

async function fetchFilingsSince(since, opts = {}) {
  const { companyIds, verdict, limit = 20 } = opts;
  let where = ' WHERE f.created_at > $1';
  const params = [since];
  let idx = 1;

  if (companyIds?.length) {
    idx++;
    where += ` AND f.company_id = ANY($${idx})`;
    params.push(companyIds);
  }
  if (verdict) {
    idx++;
    where += ` AND LOWER(a.verdict) = LOWER($${idx})`;
    params.push(verdict);
  }

  idx++;
  params.push(limit);

  const r = await db.query(
    `SELECT f.id, f.company_id, f.company_name, f.filing_type, f.created_at,
            COALESCE(NULLIF(f.exchange, ''), c.exchange) AS exchange,
            c.ticker,
            a.verdict, a.summary, a.verdict_reason
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
       LEFT JOIN companies c ON c.id = f.company_id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT $${idx}`,
    params,
  );
  return r.rows.map(enrichFiling);
}

async function fetchNewsSince(since, limit = 30) {
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
      ORDER BY GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) DESC
      LIMIT $2`,
    [since, limit],
  );
  const base = (process.env.APP_URL || 'https://orewire.com').replace(/\/$/, '');
  return r.rows.map((row) => {
    const ticker = row.company_ticker || row.ticker;
    const exchange = row.exchange;
    const slug = ticker && exchange ? `${fmtExchange(exchange)}: ${ticker.toUpperCase()}` : (ticker || 'News');
    const headline = (row.summary || row.title || '').trim();
    const short = headline.length > 120 ? `${headline.slice(0, 117)}…` : headline;
    return {
      slugLabel: slug,
      companyName: row.company_name,
      title: row.title,
      line: short,
      href: row.link ? `${base}/news/${encodeURIComponent(row.link)}` : `${base}/news`,
    };
  });
}

async function fetchWatchlistCompanyIds(userId) {
  const r = await db.query(
    `SELECT company_id FROM watchlist
      WHERE user_id = $1 AND item_type = 'company' AND company_id IS NOT NULL`,
    [userId],
  );
  return r.rows.map((x) => x.company_id);
}

async function buildGlobalBriefingData() {
  const since = new Date(Date.now() - HOURS_24_MS);
  const [commodities, indexes, currencies, noteworthy, watch, routine, news] = await Promise.all([
    getCommoditiesPayload(),
    getIndexesPayload(),
    getCurrenciesPayload(),
    fetchFilingsSince(since, { verdict: 'noteworthy', limit: 8 }),
    fetchFilingsSince(since, { verdict: 'watch', limit: 12 }),
    fetchFilingsSince(since, { verdict: 'routine', limit: 18 }),
    fetchNewsSince(since, 30),
  ]);

  return {
    commodities: commodities.items || [],
    indexes: indexes.items || [],
    currencies: currencies.items || [],
    noteworthy,
    watch,
    routine,
    news,
    counts: {
      noteworthy: noteworthy.length,
      watch: watch.length,
      news: news.length,
      routine: routine.length,
    },
  };
}

async function buildUserBriefingData(userId) {
  const global = await buildGlobalBriefingData();
  const since = new Date(Date.now() - HOURS_24_MS);
  const companyIds = await fetchWatchlistCompanyIds(userId);
  const watchlistFilings = companyIds.length
    ? await fetchFilingsSince(since, { companyIds, limit: 10 })
    : [];

  return {
    ...global,
    watchlistFilings,
    watchlistCount: watchlistFilings.length,
  };
}

async function getBriefingRecipients() {
  const seen = new Set();
  const out = [];

  const users = await db.query(
    `SELECT id, email, first_name
       FROM users
      WHERE email_verified = TRUE
        AND COALESCE(briefing_enabled, TRUE) = TRUE`,
  );
  for (const u of users.rows) {
    const email = u.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, firstName: u.first_name, userId: u.id });
  }

  const subs = await db.query(
    `SELECT email FROM briefing_subscribers WHERE unsubscribed_at IS NULL`,
  );
  for (const s of subs.rows) {
    const email = s.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, firstName: null, userId: null });
  }

  return out;
}

module.exports = {
  buildGlobalBriefingData,
  buildUserBriefingData,
  getBriefingRecipients,
  fetchFilingsSince,
  companySlug,
};
