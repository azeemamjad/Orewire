const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'orewire2024';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const sessions = new Map();

function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
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
  return true;
}

// POST /api/auth/login
router.post('/login', express.json(), (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (hash(password) !== hash(ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = createSession();
  res.json({ token });
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (validateSession(token)) return res.json({ ok: true });
  res.status(401).json({ error: 'Session expired or invalid' });
});

// Middleware to protect static admin routes
function adminAuth(req, res, next) {
  // Allow auth API calls without token
  if (req.path === '/' || req.path === '/login' || req.path === '/check') return next();

  // For API routes, check x-auth-token header
  if (req.path.startsWith('/api/')) {
    const token = req.headers['x-auth-token'];
    if (validateSession(token)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { router, adminAuth };
