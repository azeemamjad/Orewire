const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { attachUser, requireUser } = require('../auth');

// Tables created by db/migrate.js

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatJob(row) {
  return {
    id: row.id,
    companyName: row.company_name,
    ticker: row.ticker || null,
    title: row.title,
    location: row.location,
    contactEmail: row.contact_email,
    description: row.description || '',
    salary: row.salary || null,
    discipline: row.discipline || null,
    jobType: row.job_type || 'Full-time',
    tags: row.tags || [],
    promoted: row.promoted || false,
    status: row.status,
    timeAgo: timeAgo(row.created_at),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// GET /api/jobs — list active jobs
router.get('/', async (req, res) => {
  try {
    const { search, discipline, type } = req.query;

    const where = ["status = 'active'", "expires_at > NOW()"];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(title ILIKE $${params.length} OR company_name ILIKE $${params.length} OR location ILIKE $${params.length} OR array_to_string(tags, ' ') ILIKE $${params.length})`);
    }
    if (discipline && discipline !== 'All') {
      params.push(discipline);
      where.push(`discipline = $${params.length}`);
    }
    if (type && type !== 'All') {
      params.push(type);
      where.push(`job_type = $${params.length}`);
    }

    const sql = `
      SELECT * FROM jobs
      WHERE ${where.join(' AND ')}
      ORDER BY promoted DESC, created_at DESC
      LIMIT 50
    `;

    const result = await db.query(sql, params);
    res.json({ jobs: result.rows.map(formatJob) });
  } catch (err) {
    console.error('Jobs list query failed:', err?.message || err);
    res.status(503).json({ jobs: [] });
  }
});

// POST /api/jobs — create a job listing (requires auth)
router.post('/', requireUser, async (req, res) => {
  try {
    const { companyName, ticker, title, location, contactEmail, description, salary, discipline, jobType, tags } = req.body || {};

    if (!companyName || !title || !location || !contactEmail) {
      return res.status(400).json({ error: 'Company name, job title, location, and contact email are required' });
    }

    const result = await db.query(`
      INSERT INTO jobs (user_id, company_name, ticker, title, location, contact_email, description, salary, discipline, job_type, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      req.user.id,
      companyName,
      ticker || null,
      title,
      location,
      contactEmail,
      description || null,
      salary || null,
      discipline || null,
      jobType || 'Full-time',
      Array.isArray(tags) ? tags : [],
    ]);

    res.status(201).json(formatJob(result.rows[0]));
  } catch (err) {
    console.error('Job post failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to post job' });
  }
});

// PATCH /api/jobs/:id/status — set active/private (owner only)
router.patch('/:id/status', requireUser, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'private'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or private' });
    }
    const result = await db.query(
      `UPDATE jobs SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
    res.json(formatJob(result.rows[0]));
  } catch (err) {
    console.error('Job status update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update job status' });
  }
});

// DELETE /api/jobs/:id — delete own job
router.delete('/:id', requireUser, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM jobs WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found or not yours' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Job delete failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

module.exports = router;
