const express = require('express');
const db = require('../db');

const router = express.Router();

function formatUser(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    email: row.email,
    username: row.username || null,
    name: name || null,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    emailVerified: Boolean(row.email_verified),
    twoStepEnabled: Boolean(row.two_step_enabled),
    briefingEnabled: row.briefing_enabled != null ? Boolean(row.briefing_enabled) : true,
    watchlistAlertsEnabled: row.watchlist_alerts_enabled != null ? Boolean(row.watchlist_alerts_enabled) : true,
    createdAt: row.created_at,
  };
}

// GET /api/admin/users
router.get('/', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT id, email, username, first_name, last_name, email_verified, two_step_enabled,
              briefing_enabled, watchlist_alerts_enabled, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 2000`,
    );
    res.json({
      total: r.rows.length,
      items: r.rows.map(formatUser),
    });
  } catch (err) {
    console.error('Admin users list failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

module.exports = router;
