const express = require('express');
const db = require('../../db');
const { hashPassword, generateTempPassword } = require('../../lib/password');
const { sendAdminCredentialsEmail } = require('../../lib/email');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const NAME_MIN_LEN = 2;

function formatUser(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    email: row.email,
    username: row.username || null,
    name: name || null,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    company: row.company || null,
    emailVerified: Boolean(row.email_verified),
    twoStepEnabled: Boolean(row.two_step_enabled),
    briefingEnabled: row.briefing_enabled != null ? Boolean(row.briefing_enabled) : true,
    watchlistAlertsEnabled: row.watchlist_alerts_enabled != null ? Boolean(row.watchlist_alerts_enabled) : true,
    mustChangePassword: Boolean(row.must_change_password),
    createdByAdmin: Boolean(row.created_by_admin),
    createdAt: row.created_at,
  };
}

function validateName(value, label) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < NAME_MIN_LEN) {
    return { ok: false, error: `${label} must be at least ${NAME_MIN_LEN} characters` };
  }
  return { ok: true, value: trimmed };
}

const USER_SELECT = `id, email, username, first_name, last_name, company, email_verified, two_step_enabled,
  briefing_enabled, watchlist_alerts_enabled, must_change_password, created_by_admin, created_at`;

function trimCompany(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.length > 100 ? s.slice(0, 100) : s;
}

// GET /api/admin/users
router.get('/', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT ${USER_SELECT} FROM users ORDER BY created_at DESC LIMIT 2000`,
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

// POST /api/admin/users — create user (optional password; auto-generate if omitted)
router.post('/', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const first = validateName(body.firstName, 'First name');
    if (!first.ok) return res.status(400).json({ error: first.error });
    const last = validateName(body.lastName, 'Last name');
    if (!last.ok) return res.status(400).json({ error: last.error });

    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const usernameRaw = String(body.username || '').trim();
    if (usernameRaw && !USERNAME_RE.test(usernameRaw)) {
      return res.status(400).json({ error: 'Username must be 3-24 chars: letters, numbers or underscore' });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

    if (usernameRaw) {
      const dupeUser = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [usernameRaw]);
      if (dupeUser.rows.length) return res.status(409).json({ error: 'Username already taken' });
    }

    let plainPassword = String(body.password || '').trim();
    const generated = !plainPassword;
    if (!plainPassword) plainPassword = generateTempPassword(12);
    if (plainPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { salt, hash } = hashPassword(plainPassword);
    const sendEmail = body.sendEmail !== false;

    const inserted = await db.query(
      `INSERT INTO users (
         first_name, last_name, username, email, password, salt, company,
         email_verified, must_change_password, created_by_admin, password_set_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE, TRUE, NOW())
       RETURNING ${USER_SELECT}`,
      [first.value, last.value, usernameRaw || null, email, hash, salt, trimCompany(body.company)],
    );
    const user = formatUser(inserted.rows[0]);

    let emailed = false;
    if (sendEmail) {
      try {
        await sendAdminCredentialsEmail({
          email,
          firstName: first.value,
          tempPassword: plainPassword,
          isNewAccount: true,
        });
        emailed = true;
      } catch (mailErr) {
        console.error('Admin credentials email failed:', mailErr?.message || mailErr);
      }
    }

    res.status(201).json({
      user,
      tempPassword: plainPassword,
      generated,
      emailed,
    });
  } catch (err) {
    console.error('Admin create user failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /api/admin/users/:id/reset-password — generate temp password, optionally email
router.post('/:id/reset-password', express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const existing = await db.query(
      `SELECT ${USER_SELECT} FROM users WHERE id = $1`,
      [id],
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'User not found' });

    const plainPassword = generateTempPassword(12);
    const { salt, hash } = hashPassword(plainPassword);
    const sendEmail = req.body?.sendEmail !== false;

    const updated = await db.query(
      `UPDATE users
       SET password = $1, salt = $2, must_change_password = TRUE, password_set_at = NOW()
       WHERE id = $3
       RETURNING ${USER_SELECT}`,
      [hash, salt, id],
    );
    const user = formatUser(updated.rows[0]);

    let emailed = false;
    if (sendEmail) {
      try {
        await sendAdminCredentialsEmail({
          email: user.email,
          firstName: user.firstName || user.name,
          tempPassword: plainPassword,
          isNewAccount: false,
        });
        emailed = true;
      } catch (mailErr) {
        console.error('Admin reset email failed:', mailErr?.message || mailErr);
      }
    }

    res.json({ user, tempPassword: plainPassword, emailed });
  } catch (err) {
    console.error('Admin reset password failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
