'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { accessPassword, sessionSecret, apiTokenPath, profileDir } = require('./config');

const COOKIE_NAME = 'x_browser_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadOrCreateApiToken() {
  ensureDir(profileDir());
  const file = apiTokenPath();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 24) return existing;
  } catch {
    /* create */
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionCookieValue() {
  return signSession({
    ok: true,
    exp: Date.now() + SESSION_TTL_MS,
  });
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function checkPassword(password) {
  const expected = accessPassword();
  if (!expected) {
    throw new Error(
      'X_BROWSER_PASSWORD is not set. Add it to Server/.env before opening the viewer.',
    );
  }
  return timingSafeEqualStr(String(password || ''), expected);
}

function hasValidViewerSession(req) {
  const cookies = parseCookies(req);
  return !!verifySession(cookies[COOKIE_NAME]);
}

function requireViewerSession(req, res, next) {
  if (hasValidViewerSession(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Login required' });
  }
  return res.redirect('/login');
}

function requireApiBearer(req, res, next) {
  const token = loadOrCreateApiToken();
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = m ? m[1].trim() : String(req.headers['x-api-token'] || '').trim();
  if (provided && timingSafeEqualStr(provided, token)) return next();
  // Allow viewer session for interactive API (screenshot status from UI)
  if (hasValidViewerSession(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function setSessionCookie(res, value, { path = '/' } = {}) {
  const secure = String(process.env.X_BROWSER_SECURE_COOKIE || '').toLowerCase() === '1'
    || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=${path || '/'}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, { path = '/' } = {}) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=${path || '/'}; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

module.exports = {
  COOKIE_NAME,
  loadOrCreateApiToken,
  checkPassword,
  createSessionCookieValue,
  verifySession,
  hasValidViewerSession,
  requireViewerSession,
  requireApiBearer,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
};
