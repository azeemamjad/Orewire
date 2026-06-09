const { URL } = require('url');
const net = require('net');

const WORKER_ID_RE = /^relay-(dc|res|local)-\d+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LEN = 512;

/** Allowed worker IDs only — prevents path injection */
function assertValidWorkerId(id) {
  if (!id || typeof id !== 'string' || !WORKER_ID_RE.test(id)) {
    throw new Error('Invalid worker id');
  }
  return id;
}

function assertValidViewTokenParam(token) {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LEN) {
    return false;
  }
  return TOKEN_RE.test(token);
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Detect non-canonical IP encodings that slip past net.isIP() but are still
 * resolved by the OS to a real (often private) address — e.g. the decimal form
 * http://2130706433/, hex 0x7f000001, octal 0177.0.0.1. These are classic SSRF
 * bypasses, so we reject anything that is purely numeric/hex but not a canonical
 * dotted-quad IPv4.
 */
function looksLikeObfuscatedIp(host) {
  if (/^0x[0-9a-f]+$/i.test(host)) return true;        // hex integer
  if (/^\d+$/.test(host)) return true;                 // decimal/octal integer
  if (host.includes('.')) {
    const labels = host.split('.');
    const allNumericish = labels.every((l) => /^(0x[0-9a-f]+|\d+)$/i.test(l));
    if (allNumericish && net.isIP(host) !== 4) return true; // octal/hex dotted form
  }
  return false;
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0') return true;
  if (looksLikeObfuscatedIp(host)) return true;
  if (net.isIP(host) === 4 && isPrivateIpv4(host)) return true;
  if (net.isIP(host) === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
      return true;
    }
  }
  // NOTE: residual SSRF risk remains via DNS rebinding (a public hostname that
  // resolves to a private IP). Fully closing that requires resolving the host
  // and re-checking the resolved address before navigation.
  return false;
}

/**
 * Block SSRF: no file/data/javascript, no private IPs, no metadata endpoints.
 * Only http(s) to public hosts (or RELAY_ALLOW_LOCAL_NAV=true for dev).
 */
function assertAllowedNavigationUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('URL is empty');
  if (/^(file|javascript|data|blob):/i.test(raw)) {
    throw new Error('URL scheme not allowed');
  }

  let parsed;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  const allowLocal = process.env.RELAY_ALLOW_LOCAL_NAV === 'true';
  if (!allowLocal && isBlockedHost(parsed.hostname)) {
    throw new Error('Navigation to local or private addresses is not allowed');
  }

  if (parsed.hostname === 'metadata.google.internal') {
    throw new Error('Navigation to metadata endpoints is not allowed');
  }

  return parsed.toString();
}

/** Safe embed of token into view.html script — prevents XSS */
function escapeJsString(value) {
  return JSON.stringify(String(value));
}

function assertRelaySecretsConfigured() {
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.RELAY_VIEW_SECRET || process.env.JWT_SECRET;
    if (!secret || secret === 'relay-view-secret-change-me') {
      console.warn('[Relay] WARNING: Set RELAY_VIEW_SECRET in production');
    }
  }
}

module.exports = {
  WORKER_ID_RE,
  assertValidWorkerId,
  assertValidViewTokenParam,
  assertAllowedNavigationUrl,
  escapeJsString,
  assertRelaySecretsConfigured,
  isBlockedHost,
};
