/**
 * DB-backed proxy config, in-memory cache, and usage tracking.
 */
const db = require('../db');
const { retentionDays } = require('../lib/usage-log-retention');

const DIRECT_WORKER_ID = 'relay-direct-1';

let _cache = {
  proxies: [],
  loadedAt: 0,
};

function stripScheme(value) {
  return String(value || '').replace(/^https?:\/\//, '');
}

function parseHostPort(server, fallbackPort) {
  const bare = stripScheme(server);
  if (!bare) return { host: '', port: fallbackPort };
  const colon = bare.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(bare.slice(colon + 1))) {
    return { host: bare.slice(0, colon), port: parseInt(bare.slice(colon + 1), 10) };
  }
  return { host: bare, port: fallbackPort };
}

/** Oxylabs residential requires customer-USERNAME; sessid must be alphanumeric */
function residentialUsername(baseUser, sessid) {
  if (!baseUser) return null;
  let user = baseUser.startsWith('customer-') ? baseUser : `customer-${baseUser}`;
  if (/sessid-/i.test(user)) {
    return user.replace(/sessid-[\w-]+/i, `sessid-${sessid}`);
  }
  return `${user}-sessid-${sessid}`;
}

function tierToRelayTier(dbTier) {
  if (dbTier === 'residential') return 'res';
  if (dbTier === 'datacenter') return 'dc';
  return 'dc';
}

function relayTierToDbTier(tier) {
  if (tier === 'res') return 'residential';
  if (tier === 'dc') return 'datacenter';
  return 'datacenter';
}

function rowToPlaywrightProxy(row) {
  if (!row) return getDirectProxyConfig();
  const server = `http://${row.host}:${row.port}`;
  let username = row.username || null;
  if (row.tier === 'residential' && username && row.sessid) {
    username = residentialUsername(username, row.sessid);
  }
  return {
    proxy_id: row.id,
    tier: row.tier,
    relay_tier: tierToRelayTier(row.tier),
    slot: null,
    server,
    username,
    password: row.password || null,
    label: row.name,
  };
}

function getDirectProxyConfig() {
  return {
    proxy_id: null,
    tier: 'direct',
    relay_tier: 'direct',
    slot: 1,
    server: null,
    username: null,
    password: null,
    label: 'Local IP (no proxy)',
  };
}

function maskUsername(username) {
  if (!username) return null;
  return username.replace(/(sessid-)[\w-]+/i, '$1***');
}

function formatProxyRow(row, { includePassword = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    relayTier: tierToRelayTier(row.tier),
    host: row.host,
    port: row.port,
    username: maskUsername(row.username),
    passwordSet: !!row.password,
    password: includePassword ? row.password : undefined,
    sessid: row.sessid,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    sessionCount: row.session_count,
    errorCount: row.error_count,
    lastUsedAt: row.last_used_at,
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    workerId: `relay-proxy-${row.id}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function refreshProxyCache() {
  const { rows } = await db.query(
    `SELECT * FROM browser_proxies ORDER BY sort_order ASC, id ASC`,
  );
  _cache.proxies = rows;
  _cache.loadedAt = Date.now();
  return _cache;
}

function invalidateProxyCache() {
  _cache.loadedAt = 0;
}

function getCachedProxies() {
  return _cache.proxies;
}

function getEnabledProxies() {
  return _cache.proxies.filter((p) => p.enabled);
}

function getProxiesForRelayTier(relayTier) {
  const dbTier = relayTierToDbTier(relayTier);
  if (relayTier === 'direct') return [];
  return getEnabledProxies().filter((p) => p.tier === dbTier);
}

function workerIdForProxyRow(row) {
  return `relay-proxy-${row.id}`;
}

function getProxyWorkersForTier(relayTier) {
  if (relayTier === 'direct') return [DIRECT_WORKER_ID];
  return getProxiesForRelayTier(relayTier).map(workerIdForProxyRow);
}

function getPoolCounts() {
  const enabled = getEnabledProxies();
  const dcCount = enabled.filter((p) => p.tier === 'datacenter').length;
  const resCount = enabled.filter((p) => p.tier === 'residential').length;
  const directCount = 1;
  return {
    dcCount,
    resCount,
    directCount,
    total: enabled.length + directCount,
  };
}

function buildWorkerPlans() {
  const startUrl = process.env.RELAY_START_URL || 'about:blank';
  const plans = [];

  for (const row of getEnabledProxies()) {
    plans.push({
      id: workerIdForProxyRow(row),
      label: row.name,
      url: startUrl,
      proxy_id: row.id,
      proxy: rowToPlaywrightProxy(row),
    });
  }

  plans.push({
    id: DIRECT_WORKER_ID,
    label: 'Direct (local IP)',
    url: startUrl,
    proxy_id: null,
    proxy: getDirectProxyConfig(),
  });

  return plans;
}

function getProxyInventory() {
  const { dcCount, resCount, directCount, total } = getPoolCounts();
  const all = _cache.proxies;
  return {
    source: 'database',
    datacenter: {
      workers: dcCount,
      configured: all.filter((p) => p.tier === 'datacenter').length,
      enabled: dcCount,
    },
    residential: {
      workers: resCount,
      configured: all.filter((p) => p.tier === 'residential').length,
      enabled: resCount,
    },
    direct: {
      workers: directCount,
      note: 'Fixed relay-direct-1 — server public IP',
    },
    totalWorkers: total,
    proxies: all.map((r) => formatProxyRow(r)),
  };
}

function maskProxyForApi(proxy) {
  if (!proxy) return null;
  return {
    proxy_id: proxy.proxy_id,
    tier: proxy.tier,
    relay_tier: proxy.relay_tier,
    label: proxy.label,
    server: proxy.server,
    username: maskUsername(proxy.username),
  };
}

function parseProxyIdFromWorkerId(workerId) {
  const m = String(workerId || '').match(/^relay-proxy-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function startUsageEvent(proxyId, workerId, taskSlug) {
  const r = await db.query(
    `INSERT INTO proxy_usage_events (proxy_id, worker_id, task_slug, started_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [proxyId, workerId, taskSlug || null],
  );
  return r.rows[0]?.id;
}

async function finishUsageEvent(eventId, status, errorMessage = null) {
  if (!eventId) return;
  const r = await db.query(
    `UPDATE proxy_usage_events
     SET ended_at = NOW(), status = $2, error_message = $3
     WHERE id = $1
     RETURNING proxy_id`,
    [eventId, status, errorMessage],
  );
  const proxyId = r.rows[0]?.proxy_id;
  if (!proxyId) return;

  const isError = status === 'error' || status === 'captcha';
  await db.query(
    `UPDATE browser_proxies SET
       session_count = session_count + 1,
       error_count = error_count + $2,
       last_used_at = NOW(),
       last_error_at = CASE WHEN $2 > 0 THEN NOW() ELSE last_error_at END,
       last_error_message = CASE WHEN $2 > 0 THEN $3 ELSE last_error_message END,
       updated_at = NOW()
     WHERE id = $1`,
    [proxyId, isError ? 1 : 0, errorMessage],
  );
  invalidateProxyCache();
}

async function listAllProxies() {
  const { rows } = await db.query(
    `SELECT * FROM browser_proxies ORDER BY sort_order ASC, id ASC`,
  );
  await refreshProxyCache();
  return rows;
}

async function getProxyById(id) {
  const r = await db.query(`SELECT * FROM browser_proxies WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function createProxy(data) {
  const r = await db.query(
    `INSERT INTO browser_proxies
      (name, tier, host, port, username, password, sessid, enabled, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.name,
      data.tier,
      data.host,
      data.port,
      data.username || null,
      data.password || null,
      data.sessid || null,
      data.enabled !== false,
      data.sort_order ?? 0,
    ],
  );
  await refreshProxyCache();
  return r.rows[0];
}

async function updateProxy(id, data) {
  const fields = [];
  const values = [];
  let i = 1;

  const set = (col, val) => {
    fields.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (data.name !== undefined) set('name', data.name);
  if (data.tier !== undefined) set('tier', data.tier);
  if (data.host !== undefined) set('host', data.host);
  if (data.port !== undefined) set('port', data.port);
  if (data.username !== undefined) set('username', data.username || null);
  if (data.password !== undefined && data.password !== '') set('password', data.password);
  if (data.sessid !== undefined) set('sessid', data.sessid || null);
  if (data.enabled !== undefined) set('enabled', !!data.enabled);
  if (data.sort_order !== undefined) set('sort_order', data.sort_order);

  if (fields.length === 0) return getProxyById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const r = await db.query(
    `UPDATE browser_proxies SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  await refreshProxyCache();
  return r.rows[0] || null;
}

async function deleteProxy(id) {
  const r = await db.query(
    `DELETE FROM browser_proxies WHERE id = $1 RETURNING id`,
    [id],
  );
  await refreshProxyCache();
  return r.rows.length > 0;
}

async function listRecentUsageEvents(proxyId, limit = 20) {
  const days = retentionDays();
  const r = await db.query(
    `SELECT * FROM proxy_usage_events
     WHERE proxy_id IS NOT DISTINCT FROM $1
       AND started_at >= NOW() - make_interval(days => $2::int)
     ORDER BY started_at DESC
     LIMIT $3`,
    [proxyId, days, limit],
  );
  return r.rows;
}

async function listAllRecentUsageEvents(limit = 100) {
  const days = retentionDays();
  const r = await db.query(
    `SELECT e.*,
            COALESCE(p.name, CASE WHEN e.proxy_id IS NULL THEN 'Direct (local IP)' END) AS proxy_name
     FROM proxy_usage_events e
     LEFT JOIN browser_proxies p ON p.id = e.proxy_id
     WHERE e.started_at >= NOW() - make_interval(days => $1::int)
     ORDER BY e.started_at DESC
     LIMIT $2`,
    [days, limit],
  );
  return r.rows;
}

module.exports = {
  DIRECT_WORKER_ID,
  DC_PORTS: [8001, 8002, 8003, 8004, 8005],
  stripScheme,
  parseHostPort,
  residentialUsername,
  tierToRelayTier,
  relayTierToDbTier,
  rowToPlaywrightProxy,
  getDirectProxyConfig,
  formatProxyRow,
  refreshProxyCache,
  invalidateProxyCache,
  getCachedProxies,
  getEnabledProxies,
  getProxiesForRelayTier,
  workerIdForProxyRow,
  getProxyWorkersForTier,
  getPoolCounts,
  buildWorkerPlans,
  getProxyInventory,
  maskProxyForApi,
  parseProxyIdFromWorkerId,
  startUsageEvent,
  finishUsageEvent,
  listAllProxies,
  getProxyById,
  createProxy,
  updateProxy,
  deleteProxy,
  listRecentUsageEvents,
  listAllRecentUsageEvents,
};
