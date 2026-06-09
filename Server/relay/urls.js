function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function isLocalhostHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isLocalhostUrl(url) {
  try {
    return isLocalhostHost(new URL(url).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

/**
 * Public URL for Relay view links and WebSocket (must match what the browser uses).
 * Prefers RELAY_BASE_URL, then BACKEND_DOMAIN, then reverse-proxy headers.
 * Ignores RELAY_BASE_URL when it is localhost but the request is from a real host.
 */
function resolvePublicBaseUrl(req) {
  const explicit = stripTrailingSlash(process.env.RELAY_BASE_URL);
  const backendRaw = (process.env.BACKEND_DOMAIN || '').trim().replace(/^https?:\/\//, '');

  const reqHost = req?.get?.('x-forwarded-host') || req?.get?.('host') || '';
  const reqProto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https';
  const fromRequest =
    reqHost && !isLocalhostHost(reqHost) ? `${reqProto}://${reqHost}` : null;

  if (explicit && !isLocalhostUrl(explicit)) return explicit;
  if (fromRequest) return fromRequest;
  if (backendRaw && !isLocalhostHost(backendRaw)) return `https://${backendRaw}`;
  // Fall back to an explicit (possibly localhost) override, else dev default.
  if (explicit) return explicit;
  return 'http://localhost:3000';
}

module.exports = { resolvePublicBaseUrl, isLocalhostUrl };
