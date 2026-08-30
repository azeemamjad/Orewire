/**
 * The laptop SSH key that is allowed to open the reverse proxy tunnel.
 *
 * Stored as a plain file on a volume shared with the tunnel container, which
 * resolves it per connection (AuthorizedKeysCommand). That means adding or
 * rotating the key takes effect on the next connection — no redeploy, and no
 * shell on the server.
 *
 * Only the *public* key lives here. It is not a secret; the security comes from
 * the restriction prefix the tunnel container applies (`restrict`,
 * `port-forwarding`, `permitlisten`), which is why that prefix is applied there
 * and not stored alongside the key.
 */
const fs = require('fs');
const path = require('path');

// On the data volume, so the key survives redeploys — and so the sshd running in
// this same container reads exactly what the admin panel writes. No shared
// volume between containers, and nothing to misconfigure.
const KEY_FILE = process.env.TUNNEL_KEYS_FILE
  || path.join(process.env.TUNNEL_KEY_DIR || '/app/data/tunnel', 'authorized_key.pub');

// Only key types OpenSSH will accept, and only a single line. Anything with a
// newline could smuggle a second authorized_keys entry with its own options.
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+(\s+\S.*)?$/;

function keyFilePath() {
  return KEY_FILE;
}

/** @returns {{ configured: boolean, type: string|null, comment: string|null, fingerprintish: string|null, path: string, writable: boolean }} */
function getKeyInfo() {
  const info = {
    configured: false,
    type: null,
    comment: null,
    fingerprintish: null,
    path: KEY_FILE,
    writable: isWritable(),
    persisted: isPersisted(),
  };
  try {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (!raw) return info;
    const [type, blob, ...rest] = raw.split(/\s+/);
    info.configured = true;
    info.type = type || null;
    info.comment = rest.join(' ') || null;
    // Not a real SSH fingerprint — just enough to tell two keys apart in the UI
    // without shipping crypto helpers to the browser.
    info.fingerprintish = blob ? `${blob.slice(0, 12)}…${blob.slice(-12)}` : null;
  } catch {
    /* not configured yet */
  }
  return info;
}

// Shared with the boot-time check in index.js — one implementation, so the
// panel and the startup warning can never disagree.
const { isPathPersisted } = require('./mounts');

function isPersisted() {
  return isPathPersisted(path.dirname(KEY_FILE));
}

function isWritable() {
  const dir = path.dirname(KEY_FILE);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} publicKey a single-line OpenSSH public key
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function setKey(publicKey) {
  const value = String(publicKey || '').trim();
  if (!value) return { ok: false, error: 'Paste the laptop public key' };
  if (/[\r\n]/.test(value)) {
    return { ok: false, error: 'Paste a single key on one line (found a line break)' };
  }
  if (value.length > 4096) return { ok: false, error: 'Key is implausibly long' };
  if (/^-----BEGIN/.test(value)) {
    return { ok: false, error: 'That is a PRIVATE key — paste the .pub file instead' };
  }
  if (!KEY_RE.test(value)) {
    return { ok: false, error: 'Not a valid OpenSSH public key (expected e.g. "ssh-ed25519 AAAA... comment")' };
  }

  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    // The tunnel container reads this as the unprivileged AuthorizedKeysCommandUser.
    fs.writeFileSync(KEY_FILE, `${value}\n`, { mode: 0o644 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not write ${KEY_FILE}: ${err.message}` };
  }
}

function clearKey() {
  try {
    fs.rmSync(KEY_FILE, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { getKeyInfo, setKey, clearKey, keyFilePath, isPersisted };
