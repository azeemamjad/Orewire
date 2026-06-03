const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendDailyBriefings } = require('../lib/daily-briefing');
const { sendMorningWatchlistFilingAlerts } = require('../lib/watchlist-filing-alerts');
const { sendMorningBriefSubscribeEmail } = require('../lib/email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/briefing/subscribe — public newsletter signup (Morning Brief bar)
router.post('/subscribe', express.json(), async (req, res) => {
  try {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });

    const prior = await db.query(
      `SELECT unsubscribed_at FROM briefing_subscribers WHERE email = $1`,
      [email],
    );
    const isNew = prior.rows.length === 0;
    const wasUnsubscribed = prior.rows[0]?.unsubscribed_at != null;

    await db.query(
      `INSERT INTO briefing_subscribers (email)
       VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
      [email],
    );

    if (isNew || wasUnsubscribed) {
      sendMorningBriefSubscribeEmail({ email }).catch((err) => {
        console.error('Morning Brief subscribe email error:', err?.message || err);
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Briefing subscribe error:', err?.message || err);
    res.status(500).json({ error: 'Could not subscribe' });
  }
});

// POST /api/briefing/unsubscribe
router.post('/unsubscribe', express.json(), async (req, res) => {
  try {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });

    await db.query(
      `UPDATE briefing_subscribers SET unsubscribed_at = NOW() WHERE email = $1`,
      [email],
    );
    await db.query(
      `UPDATE users SET briefing_enabled = FALSE, watchlist_alerts_enabled = FALSE WHERE LOWER(email) = $1`,
      [email],
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Briefing unsubscribe error:', err?.message || err);
    res.status(500).json({ error: 'Could not unsubscribe' });
  }
});

// POST /api/briefing/send-now — manual trigger (protect with admin secret in production)
router.post('/send-now', express.json(), async (req, res) => {
  const secret = process.env.BRIEFING_SEND_SECRET || '';
  if (secret && req.headers['x-briefing-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await sendDailyBriefings();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Briefing send-now error:', err?.message || err);
    res.status(500).json({ error: 'Send failed' });
  }
});

// POST /api/briefing/send-filing-alerts — morning watchlist filing emails
router.post('/send-filing-alerts', express.json(), async (req, res) => {
  const secret = process.env.BRIEFING_SEND_SECRET || '';
  if (secret && req.headers['x-briefing-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await sendMorningWatchlistFilingAlerts();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Filing alerts send error:', err?.message || err);
    res.status(500).json({ error: 'Send failed' });
  }
});

module.exports = router;
