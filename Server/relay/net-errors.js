/**
 * What counts as "the network path is broken" rather than "this request failed".
 *
 * A dead proxy answers every request identically, so this distinction drives two
 * things: the pipeline's circuit breaker, and which proxy the relay hands out
 * next. Deliberately narrow — a generic timeout is NOT here, because a slow page
 * or a missing selector times out too and that says nothing about the proxy.
 */
const TRANSPORT_ERROR_RE = new RegExp([
  'err_tunnel_connection_failed',
  'err_proxy_connection_failed',
  'err_proxy_auth_requested',
  'err_no_supported_proxies',
  'err_connection_refused',
  'err_connection_reset',
  'err_connection_closed',
  'err_connection_failed',
  'err_name_not_resolved',
  'err_internet_disconnected',
  'err_address_unreachable',
  'econnrefused',
  'ehostunreach',
  'enetunreach',
].join('|'), 'i');

function isTransportError(err) {
  return TRANSPORT_ERROR_RE.test(err?.message || String(err || ''));
}

module.exports = { isTransportError, TRANSPORT_ERROR_RE };
