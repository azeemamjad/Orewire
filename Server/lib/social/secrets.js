/**
 * AES-256-GCM helpers for social account secrets (X password / session cookies).
 * Key: SOCIAL_SECRETS_KEY (32+ chars recommended), else derived from ADMIN_PASSWORD.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = 'orewire-social-v1';

function getKeyMaterial() {
  const raw = (process.env.SOCIAL_SECRETS_KEY || process.env.ADMIN_PASSWORD || 'orewire-dev-social-key').trim();
  return crypto.scryptSync(raw, SALT, 32);
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKeyMaterial();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const key = getKeyMaterial();
  const buf = Buffer.from(String(ciphertext), 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid ciphertext');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, undefined, 'utf8') + decipher.final('utf8');
}

function maskUsername(username) {
  const u = String(username || '').trim();
  if (!u) return '';
  if (u.length <= 3) return `${u[0]}***`;
  return `${u.slice(0, 2)}***${u.slice(-1)}`;
}

module.exports = { encrypt, decrypt, maskUsername };
