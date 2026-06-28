const db = require('../db');
const { sendWatchlistNewsAlertEmail } = require('./email');
const {
  renderWatchlistNewsAlertEmail,
  newsAlertSubject,
} = require('./watchlist-news-alert-template');
const {
  TABLE_RELEASES,
  TABLE_MARKET,
  tableForSource,
} = require('./news-db');

const SEND_DELAY_MS = Number(process.env.WATCHLIST_NEWS_SEND_DELAY_MS || 150);
const pendingKeys = new Set();
let flushTimer = null;

function appBase() {
  return (process.env.APP_URL || `https://${(process.env.FRONTEND_DOMAIN || 'orewire.com').replace(/^https?:\/\//, '')}`).replace(/\/$/, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePendingKey(key) {
  const [source, idRaw] = String(key).split(':');
  const id = parseInt(idRaw, 10);
  if (!['release', 'market'].includes(source) || !Number.isFinite(id)) return null;
  return { source, id };
}

async function loadNewsRow(newsId, source = 'release') {
  const table = tableForSource(source);
  const r = await db.query(
    `SELECT n.id, n.title, n.link, n.summary, n.description, n.sentiment, n.commodity,
            n.company_id, n.ticker AS news_ticker,
            c.name AS company_name, c.ticker, c.exchange
       FROM ${table} n
       LEFT JOIN companies c ON c.id = n.company_id
      WHERE n.id = $1 AND n.relevant = TRUE AND n.ai_processed = TRUE`,
    [newsId],
  );
  return r.rows[0] || null;
}

async function watchersForNews(news, source) {
  const r = await db.query(
    `SELECT DISTINCT u.id AS user_id, u.email
       FROM users u
       INNER JOIN watchlist w ON w.user_id = u.id AND w.item_type = 'company' AND w.company_id IS NOT NULL
       INNER JOIN companies c ON c.id = w.company_id
      WHERE u.email_verified = TRUE
        AND COALESCE(u.watchlist_alerts_enabled, TRUE) = TRUE
        AND (
          ($1::int IS NOT NULL AND w.company_id = $1)
          OR (
            $2::text IS NOT NULL
            AND $2::text <> ''
            AND UPPER(COALESCE(c.ticker, '')) = UPPER($2)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM watchlist_news_email_sent s
           WHERE s.user_id = u.id AND s.source = $3 AND s.item_id = $4
        )`,
    [news.company_id, news.news_ticker || news.ticker, source, news.id],
  );
  return r.rows;
}

function buildEmailPayload(news) {
  const base = appBase();
  const link = news.link || news.title;
  return {
    title: news.title,
    summary: news.summary,
    description: news.description,
    sentiment: news.sentiment,
    companyName: news.company_name,
    ticker: news.ticker || news.news_ticker,
    exchange: news.exchange,
    summaryUrl: `${base}/news/${encodeURIComponent(link)}`,
    originalUrl: link.startsWith('http') ? link : `${base}/news`,
  };
}

async function sendNewsAlertToUser(news, user, source) {
  const payload = buildEmailPayload(news);
  const html = renderWatchlistNewsAlertEmail(payload);
  const subject = newsAlertSubject(payload);

  await sendWatchlistNewsAlertEmail({
    email: user.email,
    subject,
    html,
  });

  await db.query(
    `INSERT INTO watchlist_news_email_sent (user_id, source, item_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, source, item_id) DO NOTHING`,
    [user.user_id, source, news.id],
  );
}

/**
 * Send watchlist news alert emails for one enriched news item.
 */
async function processWatchlistNewsEmail(newsId, source = 'release') {
  if (!process.env.RESEND_API_KEY) return { sent: 0, skipped: true };

  const news = await loadNewsRow(newsId, source);
  if (!news) return { sent: 0, reason: 'not_found' };

  const watchers = await watchersForNews(news, source);
  if (!watchers.length) return { sent: 0, reason: 'no_watchers' };

  let sent = 0;
  for (const user of watchers) {
    try {
      await sendNewsAlertToUser(news, user, source);
      sent++;
    } catch (err) {
      console.error(`[watchlist-news] Email failed ${user.email} ${source}=${newsId}:`, err?.message || err);
    }
    if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
  }

  if (sent > 0) {
    console.log(`[watchlist-news] Sent ${sent} alert(s) for ${source} #${newsId}`);
  }
  return { sent };
}

/** Queue processing to batch rapid enrichments. */
function queueWatchlistNewsEmail(newsId, source = 'release') {
  pendingKeys.add(`${source}:${newsId}`);
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    const keys = [...pendingKeys];
    pendingKeys.clear();
    flushTimer = null;
    for (const key of keys) {
      const parsed = parsePendingKey(key);
      if (!parsed) continue;
      try {
        await processWatchlistNewsEmail(parsed.id, parsed.source);
      } catch (err) {
        console.error(`[watchlist-news] process failed ${key}:`, err?.message || err);
      }
    }
  }, 2000);
}

/** Backup: process enriched news from last 48h not yet emailed. */
async function processPendingWatchlistNewsEmails() {
  if (!process.env.RESEND_API_KEY) return { sent: 0, skipped: true };

  let total = 0;
  for (const [source, table] of [['release', TABLE_RELEASES], ['market', TABLE_MARKET]]) {
    const r = await db.query(
      `SELECT n.id
         FROM ${table} n
        WHERE n.relevant = TRUE
          AND n.ai_processed = TRUE
          AND GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) > NOW() - INTERVAL '48 hours'
          AND (n.company_id IS NOT NULL OR n.ticker IS NOT NULL)
        ORDER BY n.id DESC
        LIMIT 30`,
    );

    for (const row of r.rows) {
      const result = await processWatchlistNewsEmail(row.id, source);
      total += result.sent || 0;
    }
  }
  return { sent: total };
}

module.exports = {
  processWatchlistNewsEmail,
  queueWatchlistNewsEmail,
  processPendingWatchlistNewsEmails,
};
