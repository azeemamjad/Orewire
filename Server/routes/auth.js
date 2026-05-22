const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'orewire2024';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const ADMIN_COOKIE = 'orewire_admin';

const sessions = new Map();

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

function createSession(payload = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now(), ...payload });
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return s;
}

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      salt        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

let usersTableReady = ensureUsersTable().catch(err => {
  console.error('Failed to ensure users table:', err.message);
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Cookie helpers (no external dep)
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
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function clearAdminCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

// ---------------------------------------------------------------------------
// JSON auth API (used by frontend + future user accounts)
// ---------------------------------------------------------------------------

router.post('/register', express.json(), async (req, res) => {
  try {
    await usersTableReady;
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const { salt, hash } = hashPassword(password);
    const inserted = await db.query(
      'INSERT INTO users (email, password, salt) VALUES ($1, $2, $3) RETURNING id, email',
      [email.toLowerCase(), hash, salt]
    );
    const user = inserted.rows[0];
    const token = createSession({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', express.json(), async (req, res) => {
  try {
    await usersTableReady;
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
      const token = createSession({ userId: user.id, email: user.email });
      return res.json({ token, user: { id: user.id, email: user.email } });
    }

    if (sha256(password) !== sha256(ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = createSession({ admin: true });
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/check', (req, res) => {
  const token = req.headers['x-auth-token'];
  const session = validateSession(token);
  if (session) return res.json({ ok: true, user: session.email ? { email: session.email } : null });
  res.status(401).json({ error: 'Session expired or invalid' });
});

router.post('/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin panel (cookie session) handlers + middleware
// ---------------------------------------------------------------------------

const LOGIN_HTML_PATH = '/admin/login';

function adminCookieSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE];
  const session = validateSession(token);
  return session && session.admin ? { token, session } : null;
}

// Require a valid admin cookie for protected pages — redirect to /admin/login otherwise.
function requireAdminPage(req, res, next) {
  if (adminCookieSession(req)) return next();
  const target = req.originalUrl || '/admin/';
  return res.redirect(`${LOGIN_HTML_PATH}?next=${encodeURIComponent(target)}`);
}

// Require a valid admin cookie OR x-auth-token header for API requests.
function requireAdminApi(req, res, next) {
  if (adminCookieSession(req)) return next();
  const token = req.headers['x-auth-token'];
  if (validateSession(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// POST /admin/login  (HTML form submit)
function adminLoginSubmit(req, res) {
  const { password, next: nextUrl } = req.body || {};
  if (!password || sha256(password) !== sha256(ADMIN_PASSWORD)) {
    const back = nextUrl ? `&next=${encodeURIComponent(nextUrl)}` : '';
    return res.redirect(`${LOGIN_HTML_PATH}?error=1${back}`);
  }
  const token = createSession({ admin: true });
  setAdminCookie(res, token);
  const target = (typeof nextUrl === 'string' && nextUrl.startsWith('/admin')) ? nextUrl : '/admin/';
  res.redirect(target);
}

// GET / POST /admin/logout
function adminLogout(req, res) {
  const session = adminCookieSession(req);
  if (session) sessions.delete(session.token);
  clearAdminCookie(res);
  res.redirect(LOGIN_HTML_PATH);
}

// Legacy combined middleware kept for backwards compat — still re-exported.
function adminAuth(req, res, next) {
  if (req.path === '/' || req.path === '/login' || req.path === '/check' || req.path === '/register' || req.path === '/logout') return next();
  if (req.path.startsWith('/api/')) {
    const token = req.headers['x-auth-token'];
    if (validateSession(token)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = {
  router,
  adminAuth,
  requireAdminPage,
  requireAdminApi,
  adminLoginSubmit,
  adminLogout,
};
