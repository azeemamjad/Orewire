const express = require('express');
const db = require('../db');

const publicRouter = express.Router();
const adminRouter = express.Router();

function formatMessage(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || null,
    company: row.company || null,
    subject: row.subject,
    message: row.message,
    userId: row.user_id || null,
    read: Boolean(row.read_at),
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

function trimStr(v, max) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

// POST /api/contact — public contact form
publicRouter.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const name = trimStr(body.name, 100);
    const email = trimStr(body.email, 200);
    const company = trimStr(body.company, 100);
    const subject = trimStr(body.subject, 150);
    const message = trimStr(body.message, 2000);

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const result = await db.query(
      `INSERT INTO contact_messages (name, email, company, subject, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, email, company || null, subject, message],
    );

    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Contact message submit failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/admin/contact-messages/unread-count
adminRouter.get('/unread-count', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS count FROM contact_messages WHERE read_at IS NULL`,
    );
    res.json({ count: r.rows[0]?.count || 0 });
  } catch (err) {
    console.error('Contact unread count failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

// GET /api/admin/contact-messages
adminRouter.get('/', async (req, res) => {
  try {
    const filter = String(req.query.filter || 'all').toLowerCase();
    let clause = '';
    if (filter === 'unread') clause = 'WHERE read_at IS NULL';
    else if (filter === 'read') clause = 'WHERE read_at IS NOT NULL';

    const r = await db.query(
      `SELECT id, name, email, company, subject, message, user_id, read_at, created_at
       FROM contact_messages
       ${clause}
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    res.json({ items: r.rows.map(formatMessage) });
  } catch (err) {
    console.error('Contact messages list failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// GET /api/admin/contact-messages/:id
adminRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const r = await db.query(`SELECT * FROM contact_messages WHERE id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Message not found' });

    res.json(formatMessage(r.rows[0]));
  } catch (err) {
    console.error('Contact message detail failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load message' });
  }
});

// POST /api/admin/contact-messages/:id/read — mark as read
adminRouter.post('/:id/read', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const r = await db.query(
      `UPDATE contact_messages SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Message not found' });

    res.json(formatMessage(r.rows[0]));
  } catch (err) {
    console.error('Contact message mark read failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

module.exports = { publicRouter, adminRouter };
