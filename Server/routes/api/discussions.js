const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { attachUser, requireUser } = require('../auth');

// Tables created by db/migrate.js

// GET /api/discussions/:companyId — public, but attaches user for vote info
router.get('/:companyId', attachUser, async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (!companyId) return res.status(400).json({ error: 'Invalid company ID' });

    const userId = req.user?.id || null;

    const result = await db.query(`
      SELECT
        d.id,
        d.company_id,
        d.user_id,
        u.email AS user_email,
        d.body,
        d.created_at,
        COALESCE(SUM(v.vote), 0)::int AS score,
        ${userId ? `COALESCE((SELECT vote FROM discussion_votes WHERE discussion_id = d.id AND user_id = $2), 0)` : '0'} AS user_vote
      FROM discussions d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN discussion_votes v ON v.discussion_id = d.id
      WHERE d.company_id = $1
      GROUP BY d.id, u.email
      ORDER BY d.created_at DESC
      LIMIT 50
    `, userId ? [companyId, userId] : [companyId]);

    const comments = result.rows.map(r => ({
      id: r.id,
      companyId: r.company_id,
      userId: r.user_id,
      userEmail: r.user_email,
      body: r.body,
      score: r.score,
      userVote: r.user_vote,
      createdAt: r.created_at,
    }));

    res.json(comments);
  } catch (err) {
    console.error('GET discussions error:', err);
    res.status(500).json({ error: 'Failed to fetch discussions' });
  }
});

// POST /api/discussions/:companyId — requires auth
router.post('/:companyId', requireUser, async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (!companyId) return res.status(400).json({ error: 'Invalid company ID' });

    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });

    const result = await db.query(
      `INSERT INTO discussions (company_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING id, company_id, user_id, body, created_at`,
      [companyId, req.user.id, body.trim()]
    );

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      userEmail: req.user.email,
      body: row.body,
      score: 0,
      userVote: 0,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('POST discussion error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// POST /api/discussions/:companyId/:commentId/vote — requires auth
router.post('/:companyId/:commentId/vote', requireUser, async (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId, 10);
    if (!commentId) return res.status(400).json({ error: 'Invalid comment ID' });

    const { vote } = req.body || {};
    const v = parseInt(vote, 10);

    if (v === 0) {
      await db.query(
        `DELETE FROM discussion_votes WHERE discussion_id = $1 AND user_id = $2`,
        [commentId, req.user.id]
      );
    } else if (v === 1 || v === -1) {
      await db.query(`
        INSERT INTO discussion_votes (discussion_id, user_id, vote)
        VALUES ($1, $2, $3)
        ON CONFLICT (discussion_id, user_id)
        DO UPDATE SET vote = $3
      `, [commentId, req.user.id, v]);
    } else {
      return res.status(400).json({ error: 'Vote must be -1, 0, or 1' });
    }

    const scoreResult = await db.query(
      `SELECT COALESCE(SUM(vote), 0)::int AS score FROM discussion_votes WHERE discussion_id = $1`,
      [commentId]
    );

    res.json({ score: scoreResult.rows[0].score, userVote: v });
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// DELETE /api/discussions/:companyId/:commentId — owner only
router.delete('/:companyId/:commentId', requireUser, async (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId, 10);
    const result = await db.query(
      `DELETE FROM discussions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [commentId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE discussion error:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// ---------------------------------------------------------------------------
// Commodity discussions
// ---------------------------------------------------------------------------

// GET /api/discussions/commodity/:key
router.get('/commodity/:key', attachUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const userId = req.user?.id || null;

    const result = await db.query(`
      SELECT
        d.id, d.commodity_key, d.user_id, u.email AS user_email, d.body, d.created_at,
        COALESCE(SUM(v.vote), 0)::int AS score,
        ${userId ? `COALESCE((SELECT vote FROM discussion_votes WHERE discussion_id = d.id AND user_id = $2), 0)` : '0'} AS user_vote
      FROM discussions d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN discussion_votes v ON v.discussion_id = d.id
      WHERE d.commodity_key = $1
      GROUP BY d.id, u.email
      ORDER BY d.created_at DESC
      LIMIT 50
    `, userId ? [key, userId] : [key]);

    const comments = result.rows.map(r => ({
      id: r.id,
      companyId: null,
      commodityKey: r.commodity_key,
      userId: r.user_id,
      userEmail: r.user_email,
      body: r.body,
      score: r.score,
      userVote: r.user_vote,
      createdAt: r.created_at,
    }));
    res.json(comments);
  } catch (err) {
    console.error('GET commodity discussions error:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch discussions', detail: err?.message });
  }
});

// POST /api/discussions/commodity/:key
router.post('/commodity/:key', requireUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const result = await db.query(
      `INSERT INTO discussions (commodity_key, user_id, body) VALUES ($1, $2, $3) RETURNING id, commodity_key, user_id, body, created_at`,
      [key, req.user.id, body.trim()]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id, companyId: null, commodityKey: row.commodity_key, userId: row.user_id,
      userEmail: req.user.email, body: row.body, score: 0, userVote: 0, createdAt: row.created_at,
    });
  } catch (err) {
    console.error('POST commodity discussion error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// ---------------------------------------------------------------------------
// Currency discussions
// ---------------------------------------------------------------------------

router.get('/currency/:key', attachUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const userId = req.user?.id || null;

    const result = await db.query(`
      SELECT
        d.id, d.currency_key, d.user_id, u.email AS user_email, d.body, d.created_at,
        COALESCE(SUM(v.vote), 0)::int AS score,
        ${userId ? `COALESCE((SELECT vote FROM discussion_votes WHERE discussion_id = d.id AND user_id = $2), 0)` : '0'} AS user_vote
      FROM discussions d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN discussion_votes v ON v.discussion_id = d.id
      WHERE d.currency_key = $1
      GROUP BY d.id, u.email
      ORDER BY d.created_at DESC
      LIMIT 50
    `, userId ? [key, userId] : [key]);

    const comments = result.rows.map(r => ({
      id: r.id, companyId: null, currencyKey: r.currency_key,
      userId: r.user_id, userEmail: r.user_email, body: r.body,
      score: r.score, userVote: r.user_vote, createdAt: r.created_at,
    }));
    res.json(comments);
  } catch (err) {
    console.error('GET currency discussions error:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch discussions', detail: err?.message });
  }
});

router.post('/currency/:key', requireUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const result = await db.query(
      `INSERT INTO discussions (currency_key, user_id, body) VALUES ($1, $2, $3) RETURNING id, currency_key, user_id, body, created_at`,
      [key, req.user.id, body.trim()]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id, companyId: null, currencyKey: row.currency_key, userId: row.user_id,
      userEmail: req.user.email, body: row.body, score: 0, userVote: 0, createdAt: row.created_at,
    });
  } catch (err) {
    console.error('POST currency discussion error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// ---------------------------------------------------------------------------
// Index discussions
// ---------------------------------------------------------------------------

router.get('/index/:key', attachUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const userId = req.user?.id || null;

    const result = await db.query(`
      SELECT
        d.id, d.index_key, d.user_id, u.email AS user_email, d.body, d.created_at,
        COALESCE(SUM(v.vote), 0)::int AS score,
        ${userId ? `COALESCE((SELECT vote FROM discussion_votes WHERE discussion_id = d.id AND user_id = $2), 0)` : '0'} AS user_vote
      FROM discussions d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN discussion_votes v ON v.discussion_id = d.id
      WHERE d.index_key = $1
      GROUP BY d.id, u.email
      ORDER BY d.created_at DESC
      LIMIT 50
    `, userId ? [key, userId] : [key]);

    const comments = result.rows.map(r => ({
      id: r.id, companyId: null, indexKey: r.index_key,
      userId: r.user_id, userEmail: r.user_email, body: r.body,
      score: r.score, userVote: r.user_vote, createdAt: r.created_at,
    }));
    res.json(comments);
  } catch (err) {
    console.error('GET index discussions error:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch discussions' });
  }
});

router.post('/index/:key', requireUser, async (req, res) => {
  try {
    const key = req.params.key.toUpperCase();
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const result = await db.query(
      `INSERT INTO discussions (index_key, user_id, body) VALUES ($1, $2, $3) RETURNING id, index_key, user_id, body, created_at`,
      [key, req.user.id, body.trim()]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id, companyId: null, indexKey: row.index_key, userId: row.user_id,
      userEmail: req.user.email, body: row.body, score: 0, userVote: 0, createdAt: row.created_at,
    });
  } catch (err) {
    console.error('POST index discussion error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

module.exports = router;
