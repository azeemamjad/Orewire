const express = require('express');
const db = require('../../db');
const {
  suggestTickerForCompany,
  createTickerSuggestionTask,
} = require('../../lib/companies/ticker-suggest');
const {
  runPeopleWebScrape,
  isRunning: isPeopleJobRunning,
  JOB_ID: PEOPLE_JOB_ID,
} = require('../../jobs/scrape-people-web');
const { getJob } = require('../../lib/job-tracker');

const router = express.Router();

// POST /api/admin/companies/refresh-people — start the website people-rebuild job.
// Runs in-process (job-tracked). For the full 2,301-company backfill, prefer the
// CLI (node jobs/scrape-people-web.js --all) so it survives a server restart.
router.post('/refresh-people', express.json(), (req, res) => {
  if (isPeopleJobRunning()) {
    return res.status(409).json({ error: 'People rebuild is already running' });
  }
  const opts = {
    limit: req.body?.limit != null ? Number(req.body.limit) : null,
    ticker: req.body?.ticker || null,
    all: !!req.body?.all,
  };
  runPeopleWebScrape(opts).catch((err) => {
    console.error('[people-web] run failed:', err?.message || err);
  });
  res.json({ ok: true, started: true, opts });
});

// GET /api/admin/companies/refresh-people/status
router.get('/refresh-people/status', (_req, res) => {
  const job = getJob(PEOPLE_JOB_ID) || null;
  res.json({ running: isPeopleJobRunning(), job });
});

// POST /api/admin/companies/:id/suggest-ticker
// On-demand: research a flagged company's current listing and file a VA suggestion.
router.post('/:id/suggest-ticker', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const r = await db.query(
      `SELECT id, name, exchange, ticker FROM companies WHERE id = $1`,
      [id],
    );
    const company = r.rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Manual admin action: bypass the global AI pause so the button works even
    // while automatic AI processing is paused for cost control.
    const result = await suggestTickerForCompany(company, { skipCooldown: true, bypassPause: true });
    if (!result.ok || !result.suggestion) {
      return res.json({
        ok: false,
        reason: result.reason || 'no_suggestion',
        suggestion: null,
        created: false,
      });
    }

    let created = false;
    let taskReason = null;
    if (result.suggestion.changed) {
      const c = await createTickerSuggestionTask(company, result.suggestion);
      created = c.created;
      taskReason = c.reason || null;
    }

    res.json({ ok: true, suggestion: result.suggestion, created, taskReason });
  } catch (err) {
    console.error('Suggest ticker failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Failed to research ticker' });
  }
});

module.exports = router;
