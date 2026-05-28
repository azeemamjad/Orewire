const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireUser } = require('./auth');

// GET /api/watchlist — get all items
router.get('/', requireUser, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT w.id, w.item_type, w.item_key, w.company_id, w.created_at,
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
      createdAt: r.created_at,
    })) });
  } catch (err) {
    console.error('Watchlist fetch failed:', err?.message || err);
    res.status(503).json({ items: [] });
  }
});

// POST /api/watchlist — add item
router.post('/', requireUser, async (req, res) => {
  try {
    const { itemType, itemKey, companyId } = req.body || {};
    if (!itemType || !itemKey) return res.status(400).json({ error: 'itemType and itemKey required' });

    await db.query(`
      INSERT INTO watchlist (user_id, item_type, item_key, company_id)
      VALUES ($1, $2, $3, $4)
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
