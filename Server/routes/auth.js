const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'orewire2024';
const ADMIN_COOKIE   = 'orewire_admin';

const JWT_SECRET         = process.env.JWT_SECRET || 'orewire-jwt-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'orewire-jwt-refresh-secret-change-in-production';
const ACCESS_TTL  = '5h';
const REFRESH_TTL = '7d';
const ACCESS_TTL_MS  = 5 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const AUTH_FROM_EMAIL = process.env.AUTH_FROM_EMAIL || 'auth@orewire.com';

// In-memory store for admin sessions and revoked refresh tokens.
// (Admin still uses opaque tokens — only user auth migrates to JWT.)
const adminSessions = new Map();
const revokedRefreshTokens = new Set();

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash: derived };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// JWT helpers (user auth)
// ---------------------------------------------------------------------------

function issueTokens(user) {
  const payload = { sub: user.id, email: user.email, username: user.username || null };
  const accessToken  = jwt.sign(payload, JWT_SECRET,         { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

function verifyAccessToken(token) {
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function verifyRefreshToken(token) {
  if (!token) return null;
  if (revokedRefreshTokens.has(token)) return null;
  try { return jwt.verify(token, JWT_REFRESH_SECRET); }
  catch { return null; }
}

async function sendEmailViaResend(to, subject, html) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: AUTH_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}

async function issueAndSendOtp({ userId, email, purpose }) {
  const code = generateOtpCode();
  const now = Date.now();
  const expiresAt = new Date(now + OTP_TTL_MINUTES * 60 * 1000);
  await db.query(
    `INSERT INTO auth_otps (user_id, email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId || null, email.toLowerCase(), purpose, sha256(code), expiresAt]
  );
  const purposeText =
    purpose === 'register'
      ? 'verify your account'
      : purpose === 'login_2fa'
        ? 'complete your sign in'
        : 'reset your password';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.5;">
      <h2>Orewire verification code</h2>
      <p>Use the code below to ${purposeText}:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:2px;">${code}</p>
      <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
    </div>
  `;
  await sendEmailViaResend(email.toLowerCase(), 'Your Orewire verification code', html);
}

async function canResendOtp(email, purpose) {
  const r = await db.query(
    `SELECT created_at FROM auth_otps WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [email.toLowerCase(), purpose]
  );
  const last = r.rows[0]?.created_at ? new Date(r.rows[0].created_at).getTime() : 0;
  const remainingMs = Math.max(0, OTP_RESEND_COOLDOWN_MS - (Date.now() - last));
  return { ok: remainingMs === 0, remainingMs };
}

async function consumeOtp(email, purpose, code) {
  const r = await db.query(
    `SELECT id, user_id, expires_at, consumed_at, code_hash
       FROM auth_otps
      WHERE email = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [email.toLowerCase(), purpose]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, error: 'No code found' };
  if (row.consumed_at) return { ok: false, error: 'Code already used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'Code expired' };
  if (sha256(String(code || '')) !== row.code_hash) return { ok: false, error: 'Invalid code' };
  await db.query(`UPDATE auth_otps SET consumed_at = NOW() WHERE id = $1`, [row.id]);
  return { ok: true, userId: row.user_id };
}

// ---------------------------------------------------------------------------
// Admin (opaque token) — unchanged
// ---------------------------------------------------------------------------

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, { createdAt: Date.now(), admin: true });
  return token;
}

function validateAdminSession(token) {
  if (!token) return false;
  const s = adminSessions.get(token);
  if (!s) return false;
  if (Date.now() - s.createdAt > 24 * 60 * 60 * 1000) {
    adminSessions.delete(token);
    return false;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

function setAdminCookie(res, token) {
  const maxAge = Math.floor(24 * 60 * 60);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// User auth JSON API
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const NAME_MIN_LEN = 2;

function validateName(value, label) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < NAME_MIN_LEN) {
    return { ok: false, error: `${label} must be at least ${NAME_MIN_LEN} characters` };
  }
  return { ok: true, value: trimmed };
}

router.post('/register', express.json(), async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body || {};
    if (!firstName || !lastName || !username || !email || !password) return res.status(400).json({ error: 'First name, last name, username, email and password are required' });
    const first = validateName(firstName, 'First name');
    if (!first.ok) return res.status(400).json({ error: first.error });
    const last = validateName(lastName, 'Last name');
    if (!last.ok) return res.status(400).json({ error: last.error });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-24 chars: letters, numbers or underscore' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { salt, hash } = hashPassword(password);
    const existing = await db.query('SELECT id, email_verified FROM users WHERE email = $1', [email.toLowerCase()]);
    const existingUsername = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (existing.rows.length > 0) {
      const message = existing.rows[0].email_verified
        ? 'An account with that email already exists'
        : 'Account already exists but is not verified yet. Please use resend OTP.';
      return res.status(409).json({ error: message, requiresVerification: !existing.rows[0].email_verified, email: email.toLowerCase() });
    }
    if (existingUsername.rows.length > 0) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    const inserted = await db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, salt, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id`,
      [first.value, last.value, username.trim(), email.toLowerCase(), hash, salt]
    );
    const userId = inserted.rows[0].id;

    const canResend = await canResendOtp(email, 'register');
    if (!canResend.ok) {
      return res.status(429).json({ error: `Please wait ${Math.ceil(canResend.remainingMs / 1000)} seconds before requesting another code` });
    }
    await issueAndSendOtp({ userId, email, purpose: 'register' });
    res.status(201).json({ ok: true, requiresVerification: true, email: email.toLowerCase() });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/verify-otp', express.json(), async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const verify = await consumeOtp(email, 'register', otp);
    if (!verify.ok) return res.status(400).json({ error: verify.error });

    const userResult = await db.query(
      `UPDATE users SET email_verified = TRUE
        WHERE id = $1
      RETURNING id, email, username`,
      [verify.userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { accessToken, refreshToken } = issueTokens(user);
    res.json({
      accessToken, refreshToken,
      accessExpiresAt: Date.now() + ACCESS_TTL_MS,
      refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
      user: { id: user.id, email: user.email, username: user.username || null },
      token: accessToken,
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/resend-otp', express.json(), async (req, res) => {
  try {
    const { email, purpose = 'register' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    const allowedPurpose =
      purpose === 'reset_password'
        ? 'reset_password'
        : purpose === 'login_2fa'
          ? 'login_2fa'
          : 'register';
    const canResend = await canResendOtp(email, allowedPurpose);
    if (!canResend.ok) {
      return res.status(429).json({ error: `Please wait ${Math.ceil(canResend.remainingMs / 1000)} seconds before requesting another code`, retryAfterMs: canResend.remainingMs });
    }
    const user = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!user.rows[0]) return res.json({ ok: true });
    await issueAndSendOtp({ userId: user.rows[0].id, email, purpose: allowedPurpose });
    res.json({ ok: true, retryAfterMs: OTP_RESEND_COOLDOWN_MS });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

router.post('/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });

    if (email) {
      const result = await db.query(
        'SELECT id, email, username, password, salt, two_step_enabled, email_verified, first_name, last_name FROM users WHERE email = $1 OR LOWER(username) = LOWER($1)',
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });
      if (!verifyPassword(password, user.salt, user.password)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!user.email_verified) {
        return res.status(403).json({ error: 'Please verify your email with OTP before signing in' });
      }
      if (user.two_step_enabled) {
        const canResend = await canResendOtp(user.email, 'login_2fa');
        if (!canResend.ok) {
          return res.status(429).json({
            error: `Please wait ${Math.ceil(canResend.remainingMs / 1000)} seconds before requesting another code`,
            retryAfterMs: canResend.remainingMs,
            requiresTwoStep: true,
            email: user.email,
          });
        }
        await issueAndSendOtp({ userId: user.id, email: user.email, purpose: 'login_2fa' });
        return res.json({
          ok: true,
          requiresTwoStep: true,
          email: user.email,
          retryAfterMs: OTP_RESEND_COOLDOWN_MS,
        });
      }
      const { accessToken, refreshToken } = issueTokens(user);
      return res.json({
        accessToken, refreshToken,
        accessExpiresAt:  Date.now() + ACCESS_TTL_MS,
        refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
        user: {
          id: user.id,
          email: user.email,
          username: user.username || null,
          firstName: user.first_name || null,
          lastName: user.last_name || null,
          twoStepEnabled: !!user.two_step_enabled,
        },
        token: accessToken,
      });
    }

    // Admin password fallback
    if (sha256(password) !== sha256(ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = createAdminSession();
    res.json({ token, admin: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/forgot-password', express.json(), async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) return res.json({ ok: true });
    const user = await db.query(`SELECT id, email_verified FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!user.rows[0] || !user.rows[0].email_verified) return res.json({ ok: true });
    const canResend = await canResendOtp(email, 'reset_password');
    if (!canResend.ok) {
      return res.status(429).json({ error: `Please wait ${Math.ceil(canResend.remainingMs / 1000)} seconds before requesting another code`, retryAfterMs: canResend.remainingMs });
    }
    await issueAndSendOtp({ userId: user.rows[0].id, email, purpose: 'reset_password' });
    res.json({ ok: true, retryAfterMs: OTP_RESEND_COOLDOWN_MS });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Could not process request' });
  }
});

router.post('/reset-password', express.json(), async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'Email, OTP and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const verify = await consumeOtp(email, 'reset_password', otp);
    if (!verify.ok) return res.status(400).json({ error: verify.error });
    const { salt, hash } = hashPassword(newPassword);
    await db.query(`UPDATE users SET password = $1, salt = $2 WHERE id = $3`, [hash, salt, verify.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

router.post('/verify-login-otp', express.json(), async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const verify = await consumeOtp(email, 'login_2fa', otp);
    if (!verify.ok) return res.status(400).json({ error: verify.error });
    const userResult = await db.query(
      `SELECT id, email, username, first_name, last_name, two_step_enabled, email_verified
         FROM users
        WHERE id = $1`,
      [verify.userId]
    );
    const user = userResult.rows[0];
    if (!user || !user.email_verified) return res.status(401).json({ error: 'Invalid session' });
    const { accessToken, refreshToken } = issueTokens(user);
    res.json({
      accessToken, refreshToken,
      accessExpiresAt: Date.now() + ACCESS_TTL_MS,
      refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        twoStepEnabled: !!user.two_step_enabled,
      },
      token: accessToken,
    });
  } catch (err) {
    console.error('Verify login OTP error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.get('/profile', requireUser, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, email, username, first_name, last_name, two_step_enabled, email_verified, created_at
         FROM users
        WHERE id = $1`,
      [req.user.id]
    );
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        twoStepEnabled: !!user.two_step_enabled,
        emailVerified: !!user.email_verified,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/profile', requireUser, express.json(), async (req, res) => {
  try {
    const { firstName, lastName, username } = req.body || {};
    if (!firstName || !lastName || !username) {
      return res.status(400).json({ error: 'First name, last name and username are required' });
    }
    const first = validateName(firstName, 'First name');
    if (!first.ok) return res.status(400).json({ error: first.error });
    const last = validateName(lastName, 'Last name');
    if (!last.ok) return res.status(400).json({ error: last.error });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-24 chars: letters, numbers or underscore' });
    const exists = await db.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2`,
      [String(username).trim(), req.user.id]
    );
    if (exists.rows[0]) return res.status(409).json({ error: 'Username is already taken' });
    const updated = await db.query(
      `UPDATE users
          SET first_name = $1, last_name = $2, username = $3
        WHERE id = $4
      RETURNING id, email, username, first_name, last_name, two_step_enabled, email_verified, created_at`,
      [first.value, last.value, String(username).trim(), req.user.id]
    );
    const user = updated.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        twoStepEnabled: !!user.two_step_enabled,
        emailVerified: !!user.email_verified,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.patch('/profile/two-step', requireUser, express.json(), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const updated = await db.query(
      `UPDATE users SET two_step_enabled = $1
        WHERE id = $2
      RETURNING id, email, username, first_name, last_name, two_step_enabled, email_verified, created_at`,
      [enabled, req.user.id]
    );
    const user = updated.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        twoStepEnabled: !!user.two_step_enabled,
        emailVerified: !!user.email_verified,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('Two-step update error:', err);
    res.status(500).json({ error: 'Failed to update two-step verification' });
  }
});

// POST /api/auth/refresh — exchange refresh token for a new access token
router.post('/refresh', express.json(), (req, res) => {
  const { refreshToken } = req.body || {};
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const accessToken = jwt.sign({ sub: payload.sub, email: payload.email, username: payload.username || null }, JWT_SECRET, { expiresIn: ACCESS_TTL });
  res.json({
    accessToken,
    accessExpiresAt: Date.now() + ACCESS_TTL_MS,
    user: { id: payload.sub, email: payload.email, username: payload.username || null },
    token: accessToken,
  });
});

router.get('/me', (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: { id: payload.sub, email: payload.email, username: payload.username || null } });
});

router.get('/check', (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
  const payload = verifyAccessToken(token);
  if (payload) return res.json({ ok: true, user: { id: payload.sub, email: payload.email, username: payload.username || null } });
  res.status(401).json({ error: 'Session expired or invalid' });
});

router.post('/logout', express.json(), (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) revokedRefreshTokens.add(refreshToken);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin panel (cookie session) — unchanged
// ---------------------------------------------------------------------------

const LOGIN_HTML_PATH = '/admin/login';

function adminCookieSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE];
  const session = validateAdminSession(token);
  return session && session.admin ? { token, session } : null;
}

function requireAdminPage(req, res, next) {
  if (adminCookieSession(req)) return next();
  const target = req.originalUrl || '/admin/';
  return res.redirect(`${LOGIN_HTML_PATH}?next=${encodeURIComponent(target)}`);
}

function requireAdminApi(req, res, next) {
  if (adminCookieSession(req)) return next();
  const token = req.headers['x-auth-token'];
  if (validateAdminSession(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function adminLoginSubmit(req, res) {
  const { password, next: nextUrl } = req.body || {};
  if (!password || sha256(password) !== sha256(ADMIN_PASSWORD)) {
    const back = nextUrl ? `&next=${encodeURIComponent(nextUrl)}` : '';
    return res.redirect(`${LOGIN_HTML_PATH}?error=1${back}`);
  }
  const token = createAdminSession();
  setAdminCookie(res, token);
  const target = (typeof nextUrl === 'string' && nextUrl.startsWith('/admin')) ? nextUrl : '/admin/';
  res.redirect(target);
}

function adminLogout(req, res) {
  const session = adminCookieSession(req);
  if (session) adminSessions.delete(session.token);
  clearAdminCookie(res);
  res.redirect(LOGIN_HTML_PATH);
}

function adminAuth(_req, _res, next) { next(); }

// ---------------------------------------------------------------------------
// User auth middleware (JWT-based)
// ---------------------------------------------------------------------------

function extractToken(req) {
  return req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
}

function attachUser(req, _res, next) {
  req.user = null;
  const payload = verifyAccessToken(extractToken(req));
  if (payload) req.user = { id: payload.sub, email: payload.email, username: payload.username || null };
  next();
}

function requireUser(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Login required' });
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired — please log in again' });
  req.user = { id: payload.sub, email: payload.email, username: payload.username || null };
  next();
}

module.exports = {
  router,
  adminAuth,
  requireAdminPage,
  requireAdminApi,
  adminLoginSubmit,
  adminLogout,
  attachUser,
  requireUser,
};
