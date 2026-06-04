/**
 * Relay browser proxy assignment (aligned with pipeline runner ports 8001–8005).
 *
 * Datacenter: 5 Oxylabs DC ports on dc.oxylabs.io
 * Residential: PROXY_SERVER_2 (default pr.oxylabs.io:7777) — one endpoint in env;
 *   each of the 3 Relay workers gets a unique sessid in the username for separate IPs.
 */

const DC_PORTS = [8001, 8002, 8003, 8004, 8005];

function stripScheme(value) {
  return String(value || '').replace(/^https?:\/\//, '');
}

function parseHostPort(server, fallbackPort) {
  const bare = stripScheme(server);
  if (!bare) return { host: '', port: fallbackPort };
  const colon = bare.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(bare.slice(colon + 1))) {
    return { host: bare.slice(0, colon), port: bare.slice(colon + 1) };
  }
  return { host: bare, port: fallbackPort };
}

function parsePortList(envValue, fallback) {
  if (!envValue || !String(envValue).trim()) return fallback;
  return String(envValue)
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Oxylabs residential requires customer-USERNAME; sessid must be customer-USER-sessid-xxx */
function residentialUsername(baseUser, sessid) {
  if (!baseUser) return null;
  let user = baseUser.startsWith('customer-') ? baseUser : `customer-${baseUser}`;
  if (/sessid-/i.test(user)) {
    return user.replace(/sessid-[\w-]+/i, `sessid-${sessid}`);
  }
  return `${user}-sessid-${sessid}`;
}

function getDirectProxy(slotIndex) {
  return {
    tier: 'direct',
    slot: slotIndex + 1,
    server: null,
    username: null,
    password: null,
    label: 'Local IP (no proxy)',
  };
}

function getPoolCounts() {
  const dcCount = Math.max(0, parseInt(process.env.RELAY_DATACENTER_COUNT || '5', 10));
  const resCount = Math.max(0, parseInt(process.env.RELAY_RESIDENTIAL_COUNT || '3', 10));
  const directCount = Math.max(0, parseInt(process.env.RELAY_DIRECT_COUNT || '2', 10));
  const dc = Math.min(dcCount, DC_PORTS.length);
  return {
    dcCount: dc,
    resCount,
    directCount,
    total: dc + resCount + directCount,
  };
}

function getDatacenterProxy(slotIndex) {
  const port = DC_PORTS[slotIndex % DC_PORTS.length];
  const base = process.env.PROXY_SERVER || 'http://dc.oxylabs.io';
  const { host } = parseHostPort(base, null);
  const dcHost = host || 'dc.oxylabs.io';

  if (process.env.USE_PROXY !== 'true' || !process.env.PROXY_USERNAME) {
    return { tier: 'datacenter', slot: slotIndex + 1, server: null, username: null, password: null, label: `DC :${port} (direct — USE_PROXY off)` };
  }

  return {
    tier: 'datacenter',
    slot: slotIndex + 1,
    server: `http://${dcHost}:${port}`,
    username: process.env.PROXY_USERNAME || null,
    password: process.env.PROXY_PASSWORD || null,
    label: `Datacenter :${port}`,
  };
}

function getResidentialProxy(slotIndex) {
  const resPorts = parsePortList(
    process.env.RELAY_RESIDENTIAL_PORTS,
    [7777]
  );
  const port = resPorts[slotIndex % resPorts.length];
  const serverEnv =
    process.env.PROXY_SERVER_2 ||
    process.env.Proxy_Server_2 ||
    'pr.oxylabs.io:7777';
  const { host } = parseHostPort(serverEnv, '7777');
  const resHost = host || 'pr.oxylabs.io';
  const baseUser =
    process.env.PROXY_USERNAME_2 ||
    process.env.PrOXY_USERNAME_2 ||
    null;
  const password = process.env.PROXY_PASSWORD_2 || null;
  const sessid = `relay-res-${slotIndex + 1}`;
  const username = residentialUsername(baseUser, sessid);

  if (!baseUser || !password) {
    return {
      tier: 'residential',
      slot: slotIndex + 1,
      server: null,
      username: null,
      password: null,
      label: `Residential (not configured — set PROXY_SERVER_2 / PROXY_USERNAME_2)`,
    };
  }

  const multiPort = resPorts.length > 1;
  return {
    tier: 'residential',
    slot: slotIndex + 1,
    server: `http://${resHost}:${port}`,
    username,
    password,
    label: multiPort
      ? `Residential :${port}`
      : `Residential :${port} (sessid ${sessid})`,
  };
}

/** Build spawn plan: DC + residential + direct (local IP) workers */
function buildWorkerPlans() {
  const { dcCount, resCount, directCount } = getPoolCounts();
  const plans = [];
  const startUrl = process.env.RELAY_START_URL || 'about:blank';

  for (let i = 0; i < dcCount; i++) {
    const proxy = getDatacenterProxy(i);
    plans.push({
      id: `relay-dc-${i + 1}`,
      label: `Relay DC-${i + 1}`,
      url: startUrl,
      proxy,
    });
  }

  for (let i = 0; i < resCount; i++) {
    const proxy = getResidentialProxy(i);
    plans.push({
      id: `relay-res-${i + 1}`,
      label: `Relay RES-${i + 1}`,
      url: startUrl,
      proxy,
    });
  }

  for (let i = 0; i < directCount; i++) {
    const proxy = getDirectProxy(i);
    plans.push({
      id: `relay-local-${i + 1}`,
      label: `Relay LOCAL-${i + 1}`,
      url: startUrl,
      proxy,
    });
  }

  return plans;
}

/** Admin / diagnostics — how many residential endpoints are configured */
function getProxyInventory() {
  const { dcCount, resCount, directCount, total } = getPoolCounts();
  const resPorts = parsePortList(process.env.RELAY_RESIDENTIAL_PORTS, [7777]);
  const resServer =
    process.env.PROXY_SERVER_2 ||
    process.env.Proxy_Server_2 ||
    null;
  const hasResidentialCreds = !!(
    (process.env.PROXY_USERNAME_2 || process.env.PrOXY_USERNAME_2) &&
    process.env.PROXY_PASSWORD_2
  );

  return {
    datacenter: {
      workers: dcCount,
      ports: DC_PORTS.slice(0, dcCount),
      host: parseHostPort(process.env.PROXY_SERVER || 'dc.oxylabs.io', null).host || 'dc.oxylabs.io',
      enabled: process.env.USE_PROXY === 'true',
    },
    residential: {
      workers: resCount,
      endpointsInEnv: resServer ? 1 : 0,
      portsConfigured: resPorts.length,
      ports: resPorts,
      host: resServer ? parseHostPort(resServer, '7777').host : null,
      credentialsSet: hasResidentialCreds,
      note:
        resPorts.length >= resCount
          ? `${resCount} worker(s) on ${resPorts.length} port(s)`
          : `${resCount} worker(s) share port ${resPorts[0]} — unique sessid per browser`,
    },
    direct: {
      workers: directCount,
      note: 'No proxy — uses this server\'s public IP',
    },
    totalWorkers: total,
  };
}

function maskProxyForApi(proxy) {
  if (!proxy) return null;
  return {
    tier: proxy.tier,
    slot: proxy.slot,
    label: proxy.label,
    server: proxy.server,
    username: proxy.username
      ? proxy.username.replace(/(sessid-)[\w-]+/i, '$1***')
      : null,
  };
}

module.exports = {
  DC_PORTS,
  getPoolCounts,
  buildWorkerPlans,
  getProxyInventory,
  getDatacenterProxy,
  getResidentialProxy,
  getDirectProxy,
  maskProxyForApi,
};
