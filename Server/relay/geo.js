/**
 * Resolve the locale/timezone that *matches the proxy exit IP*.
 *
 * A browser reporting `America/Toronto` while its packets leave a residential
 * exit in Frankfurt is a free, unambiguous bot signal — Radware and friends
 * compare `Intl.DateTimeFormat().resolvedOptions().timeZone` against the IP's
 * geolocation. Hardcoding one timezone for every worker guarantees a mismatch
 * on any proxy that is not where you claim to be.
 *
 * So: ask ip-api.com *through the proxy itself* what the world sees, and hand
 * the answer to the browser as its real locale/timezone. Cached per proxy for
 * the process lifetime; failures fall back to the configured defaults, never
 * block a launch.
 */
const http = require('http');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // exits rotate; 6h is plenty
const LOOKUP_TIMEOUT_MS = parseInt(process.env.RELAY_GEO_TIMEOUT_MS || '8000', 10);

/** @type {Map<string, { at: number, geo: object|null }>} */
const _cache = new Map();

function geoMatchEnabled() {
  return process.env.RELAY_GEO_MATCH !== 'false';
}

function fallbackGeo() {
  return {
    locale: process.env.LOCALE || 'en-US',
    timezoneId: process.env.TIMEZONE || 'America/Toronto',
    source: 'configured',
  };
}

// ip-api.com returns the country code, not a BCP-47 locale. English-speaking
// exits keep their regional English; everything else falls back to the
// configured locale rather than inventing a language the account never uses.
const COUNTRY_LOCALE = {
  CA: 'en-CA', US: 'en-US', GB: 'en-GB', AU: 'en-AU',
  NZ: 'en-NZ', IE: 'en-IE', ZA: 'en-ZA', IN: 'en-IN',
};

function proxyCacheKey(proxy) {
  if (!proxy?.server) return 'direct';
  // Residential usernames carry a rotating sessid — key on it so each sticky
  // session gets its own geo rather than inheriting the previous exit's.
  return `${proxy.server}|${proxy.username || ''}`;
}

/**
 * Plain HTTP request through an HTTP proxy using an absolute-URI request line
 * (no CONNECT tunnel needed). Deliberately unencrypted: the payload is public
 * geo data, and this keeps the probe dependency-free and fast.
 */
function lookupThroughProxy(proxy) {
  return new Promise((resolve) => {
    const target = 'http://ip-api.com/json/?fields=status,countryCode,timezone,query';
    let opts;

    if (proxy?.server) {
      const bare = String(proxy.server).replace(/^https?:\/\//, '');
      const colon = bare.lastIndexOf(':');
      const host = colon > 0 ? bare.slice(0, colon) : bare;
      const port = colon > 0 ? parseInt(bare.slice(colon + 1), 10) : 80;
      opts = { host, port, path: target, headers: { Host: 'ip-api.com' } };
      if (proxy.username) {
        const auth = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
        opts.headers['Proxy-Authorization'] = `Basic ${auth}`;
      }
    } else {
      opts = { host: 'ip-api.com', port: 80, path: '/json/?fields=status,countryCode,timezone,query' };
    }

    const req = http.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.status === 'success' ? json : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.setTimeout(LOOKUP_TIMEOUT_MS, () => req.destroy());
    req.on('error', () => resolve(null));
    req.on('timeout', () => resolve(null));
    req.end();
  });
}

/**
 * @param {object|null} proxy Playwright-shaped proxy ({ server, username, password })
 * @returns {Promise<{ locale: string, timezoneId: string, source: string, ip?: string }>}
 */
async function resolveGeoForProxy(proxy) {
  if (!geoMatchEnabled()) return fallbackGeo();

  const key = proxyCacheKey(proxy);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.geo || fallbackGeo();
  }

  const found = await lookupThroughProxy(proxy);
  let geo = null;
  if (found?.timezone) {
    geo = {
      locale: COUNTRY_LOCALE[found.countryCode] || fallbackGeo().locale,
      timezoneId: found.timezone,
      source: 'exit-ip',
      ip: found.query,
    };
  }
  _cache.set(key, { at: Date.now(), geo });
  return geo || fallbackGeo();
}

function clearGeoCache() {
  _cache.clear();
}

module.exports = { resolveGeoForProxy, geoMatchEnabled, fallbackGeo, clearGeoCache };
