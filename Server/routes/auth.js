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
  const payload = { sub: user.id, email: user.email };
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

router.post('/register', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

    const { salt, hash } = hashPassword(password);
    const inserted = await db.query(
      'INSERT INTO users (email, password, salt) VALUES ($1, $2, $3) RETURNING id, email',
      [email.toLowerCase(), hash, salt]
    );
    const user = inserted.rows[0];
    const { accessToken, refreshToken } = issueTokens(user);
    res.status(201).json({
      accessToken, refreshToken,
      accessExpiresAt:  Date.now() + ACCESS_TTL_MS,
      refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
      user: { id: user.id, email: user.email },
      // backwards compat (old clients still using "token")
      token: accessToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });

    if (email) {
      const result = await db.query(
        'SELECT id, email, password, salt FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });
      if (!verifyPassword(password, user.salt, user.password)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const { accessToken, refreshToken } = issueTokens(user);
      return res.json({
        accessToken, refreshToken,
        accessExpiresAt:  Date.now() + ACCESS_TTL_MS,
        refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
        user: { id: user.id, email: user.email },
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

// POST /api/auth/refresh — exchange refresh token for a new access token
router.post('/refresh', express.json(), (req, res) => {
  const { refreshToken } = req.body || {};
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const accessToken = jwt.sign({ sub: payload.sub, email: payload.email }, JWT_SECRET, { expiresIn: ACCESS_TTL });
  res.json({
    accessToken,
    accessExpiresAt: Date.now() + ACCESS_TTL_MS,
    user: { id: payload.sub, email: payload.email },
    token: accessToken,
  });
});

router.get('/me', (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: { id: payload.sub, email: payload.email } });
});

router.get('/check', (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-auth-token'];
  const payload = verifyAccessToken(token);
  if (payload) return res.json({ ok: true, user: { id: payload.sub, email: payload.email } });
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
  if (payload) req.user = { id: payload.sub, email: payload.email };
  next();
}

function requireUser(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Login required' });
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired — please log in again' });
  req.user = { id: payload.sub, email: payload.email };
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
