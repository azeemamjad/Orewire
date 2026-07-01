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

function formatApp(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    resumeUrl: row.resume_url || null,
    coverLetter: row.cover_letter || null,
    expectedSalary: row.expected_salary || null,
    website: row.website || null,
    status: row.status,
    timeAgo: timeAgo(row.created_at),
    createdAt: row.created_at,
  };
}

// POST /api/applications/:jobId — apply to a job
router.post('/:jobId', attachUser, async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (!jobId) return res.status(400).json({ error: 'Invalid job ID' });

    const { name, email, phone, resumeUrl, coverLetter, expectedSalary, website } = req.body || {};
    const applicantEmail = email || (req.user?.email);

    if (!name || !applicantEmail) return res.status(400).json({ error: 'Name and email are required' });

    const result = await db.query(`
      INSERT INTO job_applications (job_id, user_id, name, email, phone, resume_url, cover_letter, expected_salary, website)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [jobId, req.user?.id || null, name, applicantEmail, phone || null, resumeUrl || null, coverLetter || null, expectedSalary || null, website || null]);

    res.status(201).json(formatApp(result.rows[0]));
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'You have already applied to this job' });
    console.error('Application submit failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// GET /api/applications/my-jobs — get all my posted jobs + their applications
router.get('/my-jobs', requireUser, async (req, res) => {
  try {
    const jobsResult = await db.query(
      `SELECT id, title, company_name, location, status, created_at FROM jobs WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );

    const appsResult = await db.query(`
      SELECT a.*
      FROM job_applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE j.user_id = $1
      ORDER BY a.created_at DESC
    `, [req.user.id]);

    const appsByJob = {};
    for (const row of appsResult.rows) {
      if (!appsByJob[row.job_id]) appsByJob[row.job_id] = [];
      appsByJob[row.job_id].push(formatApp(row));
    }

    const jobs = jobsResult.rows.map(j => ({
      jobId: j.id,
      jobTitle: j.title,
      companyName: j.company_name,
      jobLocation: j.location,
      jobStatus: j.status,
      applications: appsByJob[j.id] || [],
    }));

    res.json({ jobs });
  } catch (err) {
    console.error('My jobs applications failed:', err?.message || err);
    res.status(500).json({ jobs: [] });
  }
});

// GET /api/applications/my-applied — jobs I applied to + status
router.get('/my-applied', requireUser, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.id, a.status, a.created_at,
             j.id AS job_id, j.title AS job_title, j.company_name, j.location AS job_location, j.ticker, j.salary
      FROM job_applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
    `, [req.user.id]);

    const apps = result.rows.map(r => ({
      applicationId: r.id,
      status: r.status,
      appliedAt: r.created_at,
      timeAgo: timeAgo(r.created_at),
      jobId: r.job_id,
      jobTitle: r.job_title,
      companyName: r.company_name,
      jobLocation: r.job_location,
      ticker: r.ticker,
      salary: r.salary,
    }));

    res.json({ applications: apps });
  } catch (err) {
    console.error('My applied jobs failed:', err?.message || err);
    res.status(500).json({ applications: [] });
  }
});

// PATCH /api/applications/:appId/status — update application status (job owner only)
router.patch('/:appId/status', requireUser, async (req, res) => {
  try {
    const appId = parseInt(req.params.appId, 10);
    const { status } = req.body || {};
    if (!['new', 'reviewed', 'shortlisted', 'rejected', 'hired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(`
      UPDATE job_applications a SET status = $1
      FROM jobs j
      WHERE a.id = $2 AND a.job_id = j.id AND j.user_id = $3
      RETURNING a.*
    `, [status, appId, req.user.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found or not your job' });
    res.json(formatApp(result.rows[0]));
  } catch (err) {
    console.error('Status update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
