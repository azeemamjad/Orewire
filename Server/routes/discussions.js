const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { attachUser, requireUser } = require('./auth');

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS discussions (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS discussion_votes (
      id             SERIAL PRIMARY KEY,
      discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote           SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (discussion_id, user_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_discussions_company ON discussions(company_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_discussion_votes_disc ON discussion_votes(discussion_id)`);
}

const tablesReady = ensureTables().catch(err => {
  console.error('Failed to create discussion tables:', err.message);
});

// GET /api/discussions/:companyId — public, but attaches user for vote info
router.get('/:companyId', attachUser, async (req, res) => {
  try {
    await tablesReady;
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
    await tablesReady;
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
    await tablesReady;
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
    await tablesReady;
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

module.exports = router;
