const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { hashPassword, verifyPassword } = require('../lib/password');

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
const { sendOtpEmail, sendWelcomeEmail } = require('../lib/email');
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// In-memory store for admin sessions and revoked refresh tokens.
// (Admin still uses opaque tokens — only user auth migrates to JWT.)
const adminSessions = new Map();
const revokedRefreshTokens = new Set();
const oauthBridgeTokens = new Map();

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomSecretHex(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function googleClientSecret() {
  return String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

function callbackBase(req) {
  const fromEnv = String(process.env.GOOGLE_CALLBACK_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

function frontendOrigin(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function cleanRedirectPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '/watchlist';
  return raw.startsWith('/') ? raw : '/watchlist';
}

function issueOauthBridgeToken(payload) {
  const token = randomSecretHex(24);
  oauthBridgeTokens.set(token, {
    payload,
    expiresAt: Date.now() + (5 * 60 * 1000),
  });
  return token;
}

function consumeOauthBridgeToken(token) {
  const key = String(token || '').trim();
  if (!key) return null;
  const row = oauthBridgeTokens.get(key);
  oauthBridgeTokens.delete(key);
  if (!row) return null;
  if (row.expiresAt < Date.now()) return null;
  return row.payload;
}

function encodeState(state) {
  return jwt.sign(state, JWT_SECRET, { expiresIn: '10m' });
}

function decodeState(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function base64UrlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function generateUniqueUsername(baseCandidate, fallback = 'user') {
  const base = String(baseCandidate || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || fallback;
  return (async () => {
    for (let i = 0; i < 20; i += 1) {
      const candidate = i === 0
        ? base
        : `${base.slice(0, Math.max(1, 24 - String(i).length - 1))}_${i}`;
      const exists = await db.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [candidate]);
      if (!exists.rows[0]) return candidate;
    }
    return `${fallback.slice(0, 16)}_${randomSecretHex(4)}`;
  })();
}

async function exchangeGoogleCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}

async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'Failed to fetch Google profile');
  return data;
}

async function upsertGoogleUser(profile) {
  const email = String(profile.email || '').toLowerCase().trim();
  const subject = String(profile.sub || '').trim();
  if (!email || !subject) throw new Error('Google profile is missing email identity');
  if (profile.email_verified === false) throw new Error('Google account email is not verified');

  const existingByOauth = await db.query(
    `SELECT id, email, username, first_name, last_name, two_step_enabled, email_verified, must_change_password,
            terms_accepted_at, briefing_enabled
       FROM users
      WHERE oauth_provider = 'google' AND oauth_subject = $1
      LIMIT 1`,
    [subject],
  );
  let user = existingByOauth.rows[0] || null;

  if (!user) {
    const existingByEmail = await db.query(
      `SELECT id, email, username, first_name, last_name, two_step_enabled, email_verified, must_change_password,
              terms_accepted_at, briefing_enabled
         FROM users
        WHERE email = $1
        LIMIT 1`,
      [email],
    );
    user = existingByEmail.rows[0] || null;
  }

  const firstName = String(profile.given_name || profile.name || 'User').trim().slice(0, 100) || 'User';
  const lastName = String(profile.family_name || '').trim().slice(0, 100) || null;

  if (user) {
    const updated = await db.query(
      `UPDATE users
          SET oauth_provider = 'google',
              oauth_subject = $1,
              email_verified = TRUE,
              first_name = COALESCE(NULLIF(first_name, ''), $2),
              last_name = COALESCE(NULLIF(last_name, ''), $3)
        WHERE id = $4
      RETURNING id, email, username, first_name, last_name, two_step_enabled, email_verified, must_change_password,
                terms_accepted_at, briefing_enabled`,
      [subject, firstName, lastName, user.id],
    );
    return updated.rows[0];
  }

  const usernameSeed = profile.email ? profile.email.split('@')[0] : firstName;
  const username = await generateUniqueUsername(usernameSeed, 'user');
  const secret = randomSecretHex(24);
  const { salt, hash } = hashPassword(secret);
  const inserted = await db.query(
    `INSERT INTO users
      (first_name, last_name, username, email, password, salt, email_verified, company, oauth_provider, oauth_subject,
       must_change_password, password_set_at, terms_accepted_at, briefing_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NULL, 'google', $7, FALSE, NOW(), NULL, FALSE)
     RETURNING id, email, username, first_name, last_name, two_step_enabled, email_verified, must_change_password,
               terms_accepted_at, briefing_enabled`,
    [firstName, lastName, username, email, hash, salt, subject],
  );
  return inserted.rows[0];
}

function authPayloadFromUser(user) {
  const { accessToken, refreshToken } = issueTokens(user);
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: Date.now() + ACCESS_TTL_MS,
    refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
    user: {
      id: user.id,
      email: user.email,
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      twoStepEnabled: !!user.two_step_enabled,
      mustChangePassword: !!user.must_change_password,
      termsAccepted: !!user.terms_accepted_at,
      briefingEnabled: user.briefing_enabled != null ? !!user.briefing_enabled : true,
    },
    token: accessToken,
  };
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

async function issueAndSendOtp({ userId, email, purpose }) {
  const code = generateOtpCode();
  const now = Date.now();
  const expiresAt = new Date(now + OTP_TTL_MINUTES * 60 * 1000);
  await db.query(
    `INSERT INTO auth_otps (user_id, email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId || null, email.toLowerCase(), purpose, sha256(code), expiresAt]
  );
  await sendOtpEmail({ email, code, purpose, ttlMinutes: OTP_TTL_MINUTES });
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

function trimCompany(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.length > 100 ? s.slice(0, 100) : s;
}

router.post('/register', express.json(), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      email,
      password,
      company,
      acceptedTerms,
      briefingEnabled,
    } = req.body || {};
    if (!firstName || !lastName || !username || !email || !password) {
      return res.status(400).json({ error: 'First name, last name, username, email and password are required' });
    }
    if (!acceptedTerms) {
      return res.status(400).json({ error: 'You must agree to the terms to create an account' });
    }
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
    const wantBriefing = !!briefingEnabled;
    const inserted = await db.query(
      `INSERT INTO users
         (first_name, last_name, username, email, password, salt, email_verified, company,
          terms_accepted_at, briefing_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, NOW(), $8)
       RETURNING id`,
      [first.value, last.value, username.trim(), email.toLowerCase(), hash, salt, trimCompany(company), wantBriefing]
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
      RETURNING id, email, username, first_name`,
      [verify.userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    sendWelcomeEmail({ email: user.email, firstName: user.first_name }).catch((err) => {
      console.error('Welcome email failed:', err?.message || err);
    });

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
        'SELECT id, email, username, password, salt, two_step_enabled, email_verified, first_name, last_name, must_change_password FROM users WHERE email = $1 OR LOWER(username) = LOWER($1)',
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
          mustChangePassword: !!user.must_change_password,
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
    await db.query(
      `UPDATE users
          SET password = $1,
              salt = $2,
              must_change_password = FALSE,
              password_set_at = NOW()
        WHERE id = $3`,
      [hash, salt, verify.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

router.get('/google/start', async (req, res) => {
  try {
    if (!googleClientId() || !googleClientSecret()) {
      return res.status(500).json({ error: 'Google OAuth is not configured' });
    }
    const redirectPath = cleanRedirectPath(req.query.redirect);
    const front = frontendOrigin(req.query.frontend) || frontendOrigin(process.env.FRONTEND_URL);
    if (!front) return res.status(400).json({ error: 'Missing frontend origin' });
    const state = encodeState({
      redirectPath,
      frontendOrigin: front,
    });
    const params = new URLSearchParams({
      client_id: googleClientId(),
      redirect_uri: callbackBase(req),
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state,
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  } catch (err) {
    console.error('Google start error:', err);
    res.status(500).json({ error: 'Could not start Google sign-in' });
  }
});

router.get('/google/callback', async (req, res) => {
  const frontendFallback = frontendOrigin(process.env.FRONTEND_URL) || '';
  try {
    const { code, state } = req.query || {};
    const decoded = decodeState(String(state || ''));
    if (!decoded?.frontendOrigin) {
      return res.status(400).send('Invalid or expired OAuth state.');
    }
    const tokens = await exchangeGoogleCode({
      code: String(code || ''),
      redirectUri: callbackBase(req),
    });
    const profile = await fetchGoogleUserInfo(tokens.access_token);
    const user = await upsertGoogleUser(profile);
    const auth = authPayloadFromUser(user);
    const bridge = issueOauthBridgeToken({
      ...auth,
      redirectTo: cleanRedirectPath(decoded.redirectPath),
    });
    res.redirect(`${decoded.frontendOrigin}/auth/google/callback?token=${encodeURIComponent(bridge)}`);
  } catch (err) {
    console.error('Google callback error:', err);
    const message = encodeURIComponent(err?.message || 'Google sign-in failed');
    if (frontendFallback) {
      return res.redirect(`${frontendFallback}/login?oauth_error=${message}`);
    }
    res.status(500).send('Google sign-in failed.');
  }
});

router.get('/oauth/consume', express.json(), (req, res) => {
  const payload = consumeOauthBridgeToken(req.query.token);
  if (!payload) return res.status(400).json({ error: 'Invalid or expired OAuth token' });
  res.json(payload);
});

router.post('/verify-login-otp', express.json(), async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const verify = await consumeOtp(email, 'login_2fa', otp);
    if (!verify.ok) return res.status(400).json({ error: verify.error });
    const userResult = await db.query(
      `SELECT id, email, username, first_name, last_name, two_step_enabled, email_verified, must_change_password
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
        mustChangePassword: !!user.must_change_password,
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
      `SELECT id, email, username, first_name, last_name, company, two_step_enabled, email_verified, created_at,
              must_change_password, briefing_enabled, watchlist_alerts_enabled, cookie_consent, cookie_consent_at,
              terms_accepted_at
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
        company: user.company || null,
        twoStepEnabled: !!user.two_step_enabled,
        emailVerified: !!user.email_verified,
        createdAt: user.created_at,
        mustChangePassword: !!user.must_change_password,
        briefingEnabled: user.briefing_enabled != null ? !!user.briefing_enabled : true,
        watchlistAlertsEnabled: user.watchlist_alerts_enabled != null ? !!user.watchlist_alerts_enabled : true,
        cookieConsent: user.cookie_consent === 'accepted' || user.cookie_consent === 'necessary'
          ? user.cookie_consent
          : null,
        cookieConsentAt: user.cookie_consent_at || null,
        termsAccepted: !!user.terms_accepted_at,
      },
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/profile', requireUser, express.json(), async (req, res) => {
  try {
    const { firstName, lastName, username, company } = req.body || {};
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
          SET first_name = $1, last_name = $2, username = $3, company = $4
        WHERE id = $5
      RETURNING id, email, username, first_name, last_name, company, two_step_enabled, email_verified, created_at`,
      [first.value, last.value, String(username).trim(), trimCompany(company), req.user.id]
    );
    const user = updated.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        company: user.company || null,
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

// POST /api/auth/change-password/request-otp — email a code to the signed-in user
router.post('/change-password/request-otp', requireUser, express.json(), async (req, res) => {
  try {
    const r = await db.query('SELECT id, email, email_verified FROM users WHERE id = $1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.email) return res.status(400).json({ error: 'No email on this account' });

    const canResend = await canResendOtp(user.email, 'change_password');
    if (!canResend.ok) {
      return res.status(429).json({
        error: `Please wait ${Math.ceil(canResend.remainingMs / 1000)} seconds before requesting another code`,
        retryAfterMs: canResend.remainingMs,
      });
    }
    await issueAndSendOtp({ userId: user.id, email: user.email, purpose: 'change_password' });
    res.json({
      ok: true,
      email: user.email,
      retryAfterMs: OTP_RESEND_COOLDOWN_MS,
    });
  } catch (err) {
    console.error('Change password request OTP error:', err);
    res.status(500).json({ error: 'Could not send verification code' });
  }
});

// POST /api/auth/change-password — OTP + new password (no current password)
router.post('/change-password', requireUser, express.json(), async (req, res) => {
  try {
    const { otp, newPassword } = req.body || {};
    if (!otp || !newPassword) {
      return res.status(400).json({ error: 'Verification code and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const r = await db.query('SELECT id, email, password, salt FROM users WHERE id = $1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const verify = await consumeOtp(user.email, 'change_password', otp);
    if (!verify.ok) return res.status(400).json({ error: verify.error });
    if (verify.userId && verify.userId !== user.id) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    if (verifyPassword(newPassword, user.salt, user.password)) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const { salt, hash } = hashPassword(newPassword);
    await db.query(
      `UPDATE users
          SET password = $1, salt = $2, must_change_password = FALSE, password_set_at = NOW()
        WHERE id = $3`,
      [hash, salt, user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// PATCH /api/auth/profile/notifications — toggle email notification preferences
router.patch('/profile/notifications', requireUser, express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    if (typeof body.briefingEnabled === 'boolean') {
      params.push(body.briefingEnabled);
      sets.push(`briefing_enabled = $${params.length}`);
    }
    if (typeof body.watchlistAlertsEnabled === 'boolean') {
      params.push(body.watchlistAlertsEnabled);
      sets.push(`watchlist_alerts_enabled = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No notification settings provided' });
    params.push(req.user.id);
    const updated = await db.query(
      `UPDATE users SET ${sets.join(', ')}
        WHERE id = $${params.length}
      RETURNING briefing_enabled, watchlist_alerts_enabled`,
      params
    );
    const user = updated.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      briefingEnabled: user.briefing_enabled != null ? !!user.briefing_enabled : true,
      watchlistAlertsEnabled: user.watchlist_alerts_enabled != null ? !!user.watchlist_alerts_enabled : true,
    });
  } catch (err) {
    console.error('Notification update error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// PATCH /api/auth/profile/cookie-consent — store Accept all / Necessary only for logged-in users
router.patch('/profile/cookie-consent', requireUser, express.json(), async (req, res) => {
  try {
    const consent = String(req.body?.consent || req.body?.cookieConsent || '').trim();
    if (consent !== 'accepted' && consent !== 'necessary') {
      return res.status(400).json({ error: 'consent must be "accepted" or "necessary"' });
    }
    const updated = await db.query(
      `UPDATE users
          SET cookie_consent = $1, cookie_consent_at = NOW()
        WHERE id = $2
      RETURNING cookie_consent, cookie_consent_at`,
      [consent, req.user.id]
    );
    const user = updated.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      cookieConsent: user.cookie_consent,
      cookieConsentAt: user.cookie_consent_at,
    });
  } catch (err) {
    console.error('Cookie consent update error:', err);
    res.status(500).json({ error: 'Failed to update cookie consent' });
  }
});

// PATCH /api/auth/profile/signup-agreements — required after Google OAuth signup
router.patch('/profile/signup-agreements', requireUser, express.json(), async (req, res) => {
  try {
    const acceptedTerms = !!req.body?.acceptedTerms;
    if (!acceptedTerms) {
      return res.status(400).json({ error: 'You must agree to the terms to continue' });
    }
    const briefingEnabled = !!req.body?.briefingEnabled;
    const updated = await db.query(
      `UPDATE users
          SET terms_accepted_at = COALESCE(terms_accepted_at, NOW()),
              briefing_enabled = $1
        WHERE id = $2
      RETURNING id, email, username, first_name, last_name, terms_accepted_at, briefing_enabled, must_change_password`,
      [briefingEnabled, req.user.id]
    );
    const user = updated.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        termsAccepted: !!user.terms_accepted_at,
        briefingEnabled: !!user.briefing_enabled,
        mustChangePassword: !!user.must_change_password,
      },
    });
  } catch (err) {
    console.error('Signup agreements update error:', err);
    res.status(500).json({ error: 'Failed to save agreements' });
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

router.get('/me', async (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  let mustChangePassword = false;
  let cookieConsent = null;
  let termsAccepted = true;
  let briefingEnabled = true;
  try {
    const r = await db.query(
      'SELECT must_change_password, cookie_consent, terms_accepted_at, briefing_enabled FROM users WHERE id = $1',
      [payload.sub],
    );
    mustChangePassword = !!r.rows[0]?.must_change_password;
    const c = r.rows[0]?.cookie_consent;
    cookieConsent = c === 'accepted' || c === 'necessary' ? c : null;
    termsAccepted = !!r.rows[0]?.terms_accepted_at;
    briefingEnabled = r.rows[0]?.briefing_enabled != null ? !!r.rows[0].briefing_enabled : true;
  } catch { /* best-effort; fall back to false */ }
  res.json({
    authenticated: true,
    user: {
      id: payload.sub,
      email: payload.email,
      username: payload.username || null,
      mustChangePassword,
      cookieConsent,
      termsAccepted,
      briefingEnabled,
    },
  });
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
  const target = (typeof nextUrl === 'string' && nextUrl.startsWith('/admin')) ? nextUrl : '/admin/dashboard.html';
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
