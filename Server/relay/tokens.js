const crypto = require('crypto');
const { assertValidWorkerId } = require('./security');

const SECRET =
  process.env.RELAY_VIEW_SECRET ||
  process.env.JWT_SECRET ||
  'relay-view-secret-change-me';

const DEFAULT_TTL_MS = parseInt(process.env.RELAY_VIEW_TTL_MS || String(30 * 60 * 1000), 10);

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function createViewToken(workerId, ttlMs = DEFAULT_TTL_MS) {
  assertValidWorkerId(workerId);
  const exp = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${workerId}:${exp}:${nonce}`;
  const sig = sign(payload);
  return { token: `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`, expiresAt: exp };
}

function verifyViewToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try {
    payload = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const exp = Number(parts[parts.length - 2]);
  const workerId = parts.slice(0, -2).join(':');
  if (!workerId || !Number.isFinite(exp) || Date.now() > exp) return null;
  try {
    assertValidWorkerId(workerId);
  } catch {
    return null;
  }
  return { workerId, expiresAt: exp };
}

module.exports = { createViewToken, verifyViewToken, DEFAULT_TTL_MS };
