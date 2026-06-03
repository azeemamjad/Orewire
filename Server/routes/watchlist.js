const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireUser } = require('./auth');
const { appendMarketMoveAlerts } = require('../lib/watchlist-market-alerts');

function companyPath(exchange, ticker) {
  const ex = (exchange || '').toUpperCase().replace('-', '');
  const tk = (ticker || '').toUpperCase();
  if (ex && tk) return `${ex}-${tk}`;
  return tk || 'unknown';
}

const ALERT_JOIN = `w.user_id = $1 AND w.alerts_enabled = TRUE`;

// GET /api/watchlist/alerts?since=ISO — in-app alerts for Set-alert items only
router.get('/alerts', requireUser, async (req, res) => {
  try {
    const sinceRaw = (req.query.since || '').toString().trim();
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (!since || Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: 'Valid since query (ISO date) required' });
    }

    const userId = req.user.id;
    const alerts = [];

    const newsRes = await db.query(
      `SELECT n.id, n.title, n.link, n.pub_date, n.created_at,
              c.id AS company_id, c.name AS company_name, c.ticker, c.exchange
         FROM news n
         INNER JOIN watchlist w
           ON ${ALERT_JOIN} AND w.item_type = 'company' AND w.company_id IS NOT NULL
         INNER JOIN companies c ON c.id = w.company_id
        WHERE n.relevant = TRUE
          AND n.ai_processed = TRUE
          AND GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) > $2
          AND (
            n.company_id = c.id
            OR UPPER(COALESCE(n.ticker, '')) = UPPER(COALESCE(c.ticker, ''))
            OR n.category = 'company:' || c.ticker
            OR n.category = 'company:' || c.name
          )
        ORDER BY GREATEST(COALESCE(n.created_at, '1970-01-01'), COALESCE(n.pub_date, '1970-01-01')) DESC
        LIMIT 20`,
      [userId, since],
    );

    for (const row of newsRes.rows) {
      const at = row.created_at || row.pub_date;
      alerts.push({
        type: 'news',
        id: `news-${row.id}`,
        companyId: row.company_id,
        companyName: row.company_name,
        ticker: row.ticker,
        exchange: row.exchange,
        title: row.title,
        at: at ? new Date(at).toISOString() : new Date().toISOString(),
        href: `/news/${encodeURIComponent(row.link || row.title)}`,
      });
    }

    const filingsRes = await db.query(
      `SELECT f.id, f.company_id, f.company_name, f.filing_type, f.created_at,
              c.ticker, c.exchange, a.verdict
         FROM filings f
         INNER JOIN watchlist w
           ON ${ALERT_JOIN} AND w.item_type = 'company' AND w.company_id = f.company_id
         INNER JOIN companies c ON c.id = f.company_id
         LEFT JOIN ai_output a ON a.filing_id = f.id
        WHERE f.created_at > $2
          AND (a.verdict IS NULL OR LOWER(a.verdict) IN ('noteworthy', 'watch'))
        ORDER BY f.created_at DESC
        LIMIT 20`,
      [userId, since],
    );

    for (const row of filingsRes.rows) {
      const verdict = row.verdict
        ? row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1)
        : null;
      alerts.push({
        type: 'filing',
        id: `filing-${row.id}`,
        companyId: row.company_id,
        companyName: row.company_name,
        ticker: row.ticker,
        exchange: row.exchange,
        filingType: row.filing_type,
        verdict,
        at: new Date(row.created_at).toISOString(),
        href: `/filings/${row.id}`,
      });
    }

    const insiderRes = await db.query(
      `SELECT t.id, t.company_id, t.insider_name, t.title, t.transaction_type,
              t.shares, t.transaction_date, t.created_at,
              c.name AS company_name, c.ticker, c.exchange
         FROM insider_transactions t
         INNER JOIN watchlist w
           ON ${ALERT_JOIN} AND w.item_type = 'company' AND w.company_id = t.company_id
         INNER JOIN companies c ON c.id = t.company_id
        WHERE GREATEST(
                COALESCE(t.created_at, '1970-01-01'),
                COALESCE(t.transaction_date::timestamptz, '1970-01-01')
              ) > $2
        ORDER BY t.created_at DESC NULLS LAST, t.id DESC
        LIMIT 20`,
      [userId, since],
    );

    for (const row of insiderRes.rows) {
      const at = row.created_at || row.transaction_date;
      alerts.push({
        type: 'insider',
        id: `insider-${row.id}`,
        companyId: row.company_id,
        companyName: row.company_name,
        ticker: row.ticker,
        exchange: row.exchange,
        insiderName: row.insider_name,
        insiderTitle: row.title,
        transactionType: row.transaction_type,
        shares: row.shares,
        at: at ? new Date(at).toISOString() : new Date().toISOString(),
        href: `/company/${companyPath(row.exchange, row.ticker)}`,
      });
    }

    await appendMarketMoveAlerts(userId, alerts);

    alerts.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({ alerts, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('Item alerts failed:', err?.message || err);
    res.status(503).json({ alerts: [], serverTime: new Date().toISOString() });
  }
});

// POST /api/watchlist/alert — enable or disable in-app alerts (Set alert button)
router.post('/alert', requireUser, async (req, res) => {
  try {
    const { itemType, itemKey, companyId, enabled } = req.body || {};
    if (!itemType || !itemKey) {
      return res.status(400).json({ error: 'itemType and itemKey required' });
    }
    const on = enabled !== false;

    await db.query(
      `INSERT INTO watchlist (user_id, item_type, item_key, company_id, alerts_enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, item_type, item_key)
       DO UPDATE SET
         alerts_enabled = EXCLUDED.alerts_enabled,
         company_id = COALESCE(EXCLUDED.company_id, watchlist.company_id),
         alert_move_notified_date = CASE
           WHEN EXCLUDED.alerts_enabled = TRUE THEN watchlist.alert_move_notified_date
           ELSE NULL
         END`,
      [req.user.id, itemType, itemKey, companyId || null, on],
    );

    res.json({ ok: true, alertsEnabled: on });
  } catch (err) {
    console.error('Alert toggle failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// GET /api/watchlist/alert/check/:itemType/:itemKey
router.get('/alert/check/:itemType/:itemKey', requireUser, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT alerts_enabled FROM watchlist
        WHERE user_id = $1 AND item_type = $2 AND item_key = $3`,
      [req.user.id, req.params.itemType, req.params.itemKey],
    );
    const row = result.rows[0];
    res.json({ alertsEnabled: row ? row.alerts_enabled === true : false });
  } catch (err) {
    res.json({ alertsEnabled: false });
  }
});

// GET /api/watchlist — get all items
router.get('/', requireUser, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT w.id, w.item_type, w.item_key, w.company_id, w.created_at, w.alerts_enabled,
             c.name AS company_name, c.ticker, c.exchange, c.market_cap
      FROM watchlist w
      LEFT JOIN companies c ON c.id = w.company_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [req.user.id]);

    res.json({ items: result.rows.map(r => ({
      id: r.id,
      itemType: r.item_type,
      itemKey: r.item_key,
      companyId: r.company_id,
      companyName: r.company_name,
      ticker: r.ticker,
      exchange: r.exchange,
      marketCap: r.market_cap,
      alertsEnabled: r.alerts_enabled === true,
      createdAt: r.created_at,
    })) });
  } catch (err) {
    console.error('Watchlist fetch failed:', err?.message || err);
    res.status(503).json({ items: [] });
  }
});

// POST /api/watchlist — add item (watchlist only; does not enable alerts)
router.post('/', requireUser, async (req, res) => {
  try {
    const { itemType, itemKey, companyId } = req.body || {};
    if (!itemType || !itemKey) return res.status(400).json({ error: 'itemType and itemKey required' });

    await db.query(`
      INSERT INTO watchlist (user_id, item_type, item_key, company_id, alerts_enabled)
      VALUES ($1, $2, $3, $4, FALSE)
      ON CONFLICT (user_id, item_type, item_key) DO NOTHING
    `, [req.user.id, itemType, itemKey, companyId || null]);

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Watchlist add failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to add' });
  }
});

// DELETE /api/watchlist/:itemType/:itemKey — remove item
router.delete('/:itemType/:itemKey', requireUser, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM watchlist WHERE user_id = $1 AND item_type = $2 AND item_key = $3`,
      [req.user.id, req.params.itemType, req.params.itemKey]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Watchlist remove failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to remove' });
  }
});

// GET /api/watchlist/check/:itemType/:itemKey — check if item is in watchlist
router.get('/check/:itemType/:itemKey', requireUser, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id FROM watchlist WHERE user_id = $1 AND item_type = $2 AND item_key = $3`,
      [req.user.id, req.params.itemType, req.params.itemKey]
    );
    res.json({ watched: result.rows.length > 0 });
  } catch (err) {
    res.json({ watched: false });
  }
});

module.exports = router;
