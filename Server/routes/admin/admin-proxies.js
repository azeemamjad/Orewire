const express = require('express');
const { launchSession } = require('../../relay/engines');
const { resolveRelayHeadless } = require('../../relay/env');
const { pool } = require('../../relay/pool');
const {
  listAllProxies,
  getProxyById,
  createProxy,
  updateProxy,
  deleteProxy,
  formatProxyRow,
  listRecentUsageEvents,
  rowToPlaywrightProxy,
  DIRECT_WORKER_ID,
  invalidateProxyCache,
} = require('../../relay/proxy-store');
const { retentionDays } = require('../../lib/usage-log-retention');
const tunnelKey = require('../../lib/infra/tunnel-key');
const net = require('net');
const dns = require('dns').promises;

const router = express.Router();

const TIERS = new Set(['datacenter', 'residential']);
// IP check proves traffic actually egresses via the proxy (example.com alone is a false positive).
const IP_CHECK_URL = process.env.RELAY_PROXY_IP_URL || 'https://api.ipify.org?format=json';
const TEST_URL = process.env.RELAY_PROXY_TEST_URL || 'https://example.com/';
// Optional second probe — ASX is often blocked on datacenter IPs even when the proxy itself works.
const PROBE_URL = process.env.RELAY_PROXY_PROBE_URL || 'https://www.asx.com.au/';
const TEST_TIMEOUT_MS = parseInt(process.env.RELAY_PROXY_TEST_TIMEOUT_MS || '25000', 10);
const PROBE_TIMEOUT_MS = parseInt(process.env.RELAY_PROXY_PROBE_TIMEOUT_MS || '20000', 10);

function validateProxyBody(body, { isCreate = false } = {}) {
  const data = {};

  if (body.name !== undefined || isCreate) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required' };
    data.name = name;
  }

  if (body.tier !== undefined || isCreate) {
    const tier = String(body.tier || '').trim();
    if (!TIERS.has(tier)) return { error: 'Tier must be datacenter or residential' };
    data.tier = tier;
  }

  if (body.host !== undefined || isCreate) {
    const host = String(body.host || '').trim();
    if (!host) return { error: 'Host is required' };
    data.host = host;
  }

  if (body.port !== undefined || isCreate) {
    const port = parseInt(body.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return { error: 'Port must be 1–65535' };
    data.port = port;
  }

  if (body.username !== undefined) {
    data.username = String(body.username).trim() || null;
  }
  if (body.password !== undefined) {
    data.password = String(body.password);
  }
  if (body.sessid !== undefined) {
    data.sessid = String(body.sessid).trim() || null;
  }
  if (body.enabled !== undefined) {
    data.enabled = !!body.enabled;
  }
  if (body.fallbackOnly !== undefined) {
    data.fallback_only = !!body.fallbackOnly;
  }
  if (body.sortOrder !== undefined) {
    data.sort_order = parseInt(body.sortOrder, 10) || 0;
  }

  return { data };
}

async function fetchDirectExitIp() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(IP_CHECK_URL, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    return body?.ip || null;
  } catch {
    return null;
  }
}

async function readExitIp(page) {
  const res = await page.goto(IP_CHECK_URL, {
    waitUntil: 'domcontentloaded',
    timeout: TEST_TIMEOUT_MS,
  });
  const text = (await page.locator('body').innerText().catch(() => '')).trim();
  let ip = null;
  try {
    ip = JSON.parse(text)?.ip || null;
  } catch {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) ip = text;
  }
  return { status: res?.status() || null, ip, raw: text.slice(0, 120) };
}

async function probeUrl(page, url, timeoutMs) {
  const started = Date.now();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return { ok: true, status: res?.status() || null, ms: Date.now() - started, url };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - started, url };
  }
}

/**
 * Probe a proxy with the *same* browser the scrapers use.
 *
 * This used to launch chromium directly with its own flags, which meant the Test
 * button answered a different question from "will the pipeline work" — different
 * fingerprint, different channel, and after the driver moved to patchright it
 * needed a browser build the image does not ship at all
 * ("Executable doesn't exist at /ms-playwright/chromium_headless_shell-…").
 *
 * Going through relay/engines fixes all three: real Chrome, the production
 * configuration, and the proxy applied at launch so it cannot silently fall
 * through to a direct connection and report a false OK.
 */
async function testPlaywrightProxy(proxyConfig) {
  const started = Date.now();
  let session;
  const directIp = await fetchDirectExitIp();

  try {
    session = await launchSession({
      workerId: `proxy-test-${proxyConfig?.proxy_id ?? 'direct'}`,
      proxy: proxyConfig?.server ? proxyConfig : null,
      headless: resolveRelayHeadless(),
    });
    const { context, page } = session;

    const ipCheck = await readExitIp(page);
    if (!ipCheck.ip) {
      return {
        ok: false,
        error: `Proxy reached ${IP_CHECK_URL} but no IP was returned (${ipCheck.raw || 'empty'})`,
        ms: Date.now() - started,
        url: IP_CHECK_URL,
        status: ipCheck.status,
        directIp,
      };
    }

    // Same exit IP as the server ⇒ proxy was not applied (common false positive).
    if (directIp && ipCheck.ip === directIp && proxyConfig?.server) {
      return {
        ok: false,
        error: `Exit IP ${ipCheck.ip} matches server IP — traffic is not going through the proxy`,
        ms: Date.now() - started,
        url: IP_CHECK_URL,
        status: ipCheck.status,
        exitIp: ipCheck.ip,
        directIp,
        viaProxy: false,
      };
    }

    const site = await probeUrl(page, TEST_URL, TEST_TIMEOUT_MS);
    const probe = PROBE_URL && PROBE_URL !== TEST_URL
      ? await probeUrl(page, PROBE_URL, PROBE_TIMEOUT_MS)
      : null;

    return {
      ok: true,
      status: site.status,
      ms: Date.now() - started,
      url: TEST_URL,
      exitIp: ipCheck.ip,
      directIp,
      viaProxy: !directIp || ipCheck.ip !== directIp,
      site,
      probe,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      ms: Date.now() - started,
      url: IP_CHECK_URL,
      directIp,
    };
  } finally {
    if (session?.context) {
      try { await session.context.close(); } catch { /* ignore */ }
    }
  }
}

// GET /api/admin/proxies/usage-events — before /:id routes
router.get('/usage-events', async (_req, res) => {
  try {
    const { listAllRecentUsageEvents } = require('../../relay/proxy-store');
    const events = await listAllRecentUsageEvents(150);
    res.json({
      retentionDays: retentionDays(),
      items: events.map((e) => ({
        id: e.id,
        proxyId: e.proxy_id,
        proxyName: e.proxy_name || (e.proxy_id ? `Proxy #${e.proxy_id}` : 'Direct'),
        workerId: e.worker_id,
        taskSlug: e.task_slug,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        status: e.status,
        errorMessage: e.error_message,
      })),
    });
  } catch (err) {
    console.error('List proxy usage failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load proxy usage' });
  }
});

// POST /api/admin/proxies/rebuild-pool — before /:id routes
router.post('/rebuild-pool', async (_req, res) => {
  try {
    if (process.env.RELAY_ENABLED !== 'true') {
      return res.status(400).json({ error: 'RELAY_ENABLED must be true to rebuild pool' });
    }
    const result = await pool.rebuildPool();
    res.json({ ok: true, workers: result.workers, errors: result.errors || [] });
  } catch (err) {
    console.error('Rebuild pool failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Failed to rebuild pool' });
  }
});

// GET /api/admin/proxies
// --- Home-network tunnel key -------------------------------------------------
// Declared before '/:id' or Express matches "tunnel-key" as a proxy id.
//
// The tunnel container resolves keys per connection, so writing this file takes
// effect on the next connection — no redeploy, and no shell on the server.

/**
 * Why `ERR_PROXY_CONNECTION_FAILED` — three very different causes look identical
 * from the browser, so answer them separately: does the name resolve (is the
 * container deployed and on this network), does the port accept a connection (is
 * the laptop's tunnel actually up), and is the key on a shared volume at all.
 *
 * That last one is easy to get wrong silently: writing the key always appears to
 * succeed, because the directory is created if missing.
 */
async function probeTunnelEndpoint(host, port) {
  const out = { host, port, dns: null, address: null, reachable: false, error: null };
  try {
    const r = await dns.lookup(host);
    out.dns = 'ok';
    out.address = r.address;
  } catch (err) {
    out.dns = err.code || 'lookup failed';
    // Docker's embedded DNS returns ENOTFOUND for an unknown service name, but a
    // resolver under load (or a musl/glibc difference) answers EAI_AGAIN for the
    // same situation. Both mean "that name does not exist here".
    const unresolvable = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'ENODATA'].includes(err.code);
    out.error = unresolvable
      ? `No host named "${host}" — the proxy row's Host should be 127.0.0.1 `
        + '(the tunnel terminates inside this container).'
      : `DNS lookup for "${host}" failed (${err.code || err.message}).`;
    return out;
  }

  await new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (err) => {
      if (err) {
        out.error = err.code === 'ECONNREFUSED'
          ? `Nothing is listening on ${host}:${port}, so your laptop's tunnel is not connected. `
            + 'Check `systemctl status orewire-tunnel` on the laptop; if it is running, the key '
            + 'below is probably not the one the laptop is using, or port 2222 is not published '
            + 'on this app in Dokploy.'
          : `Could not connect to ${host}:${port} (${err.code || err.message}).`;
      } else {
        out.reachable = true;
      }
      try { sock.destroy(); } catch { /* ignore */ }
      resolve();
    };
    sock.setTimeout(5000);
    sock.on('connect', () => done(null));
    sock.on('timeout', () => done({ code: 'ETIMEDOUT' }));
    sock.on('error', done);
  });

  return out;
}

router.get('/tunnel-status', async (req, res) => {
  // The tunnel terminates on this container's loopback, so that is the default.
  const host = String(req.query.host || process.env.TUNNEL_PROXY_HOST || '127.0.0.1');
  const rawPort = parseInt(String(req.query.port || process.env.TUNNEL_PROXY_PORT || '8888'), 10);
  const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 8888;
  const key = tunnelKey.getKeyInfo();
  const endpoint = await probeTunnelEndpoint(host, port);
  res.json({ tunnelKey: key, endpoint });
});

router.get('/tunnel-key', (_req, res) => {
  res.json({ tunnelKey: tunnelKey.getKeyInfo() });
});

router.put('/tunnel-key', express.json(), (req, res) => {
  const result = tunnelKey.setKey(req.body?.publicKey);
  if (!result.ok) return res.status(400).json({ error: result.error });
  console.log('[Relay] Home-tunnel public key updated from the admin panel');
  res.json({ tunnelKey: tunnelKey.getKeyInfo() });
});

router.delete('/tunnel-key', (_req, res) => {
  const result = tunnelKey.clearKey();
  if (!result.ok) return res.status(500).json({ error: result.error });
  console.log('[Relay] Home-tunnel public key removed from the admin panel');
  res.json({ tunnelKey: tunnelKey.getKeyInfo() });
});

router.get('/', async (_req, res) => {
  try {
    const rows = await listAllProxies();
    res.json({
      directWorker: {
        id: DIRECT_WORKER_ID,
        name: 'Direct (local IP)',
        tier: 'direct',
        enabled: true,
        note: 'Always spawned — not editable',
      },
      total: rows.length,
      items: rows.map((r) => formatProxyRow(r)),
    });
  } catch (err) {
    console.error('List proxies failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load proxies' });
  }
});

// GET /api/admin/proxies/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getProxyById(id);
    if (!row) return res.status(404).json({ error: 'Proxy not found' });
    const events = await listRecentUsageEvents(id, 25);
    res.json({
      proxy: formatProxyRow(row),
      recentUsage: events.map((e) => ({
        id: e.id,
        workerId: e.worker_id,
        taskSlug: e.task_slug,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        status: e.status,
        errorMessage: e.error_message,
      })),
    });
  } catch (err) {
    console.error('Get proxy failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load proxy' });
  }
});

// POST /api/admin/proxies
router.post('/', express.json(), async (req, res) => {
  const v = validateProxyBody(req.body || {}, { isCreate: true });
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const row = await createProxy({
      name: v.data.name,
      tier: v.data.tier,
      host: v.data.host,
      port: v.data.port,
      username: v.data.username,
      password: v.data.password,
      sessid: v.data.sessid,
      enabled: v.data.enabled !== undefined ? v.data.enabled : true,
      fallback_only: !!v.data.fallback_only,
      sort_order: Number.isFinite(v.data.sort_order) ? v.data.sort_order : 0,
    });
    invalidateProxyCache();
    res.status(201).json({ proxy: formatProxyRow(row) });
  } catch (err) {
    console.error('Create proxy failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to create proxy' });
  }
});

// PATCH /api/admin/proxies/:id
router.patch('/:id', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const v = validateProxyBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const existing = await getProxyById(id);
    if (!existing) return res.status(404).json({ error: 'Proxy not found' });

    const row = await updateProxy(id, {
      ...v.data,
    });
    invalidateProxyCache();
    res.json({ proxy: formatProxyRow(row) });
  } catch (err) {
    console.error('Update proxy failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update proxy' });
  }
});

// DELETE /api/admin/proxies/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const workerId = `relay-proxy-${id}`;
    const w = pool.getWorker(workerId);
    if (w?.busy) {
      return res.status(409).json({ error: 'Proxy worker is busy — stop tasks or rebuild pool after idle' });
    }
    if (w) await pool.closeWorker(workerId);

    const ok = await deleteProxy(id);
    if (!ok) return res.status(404).json({ error: 'Proxy not found' });
    invalidateProxyCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete proxy failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to delete proxy' });
  }
});

// POST /api/admin/proxies/:id/test
router.post('/:id/test', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getProxyById(id);
    if (!row) return res.status(404).json({ error: 'Proxy not found' });
    const proxyConfig = rowToPlaywrightProxy(row);
    const result = await testPlaywrightProxy(proxyConfig);
    res.json({ proxy: formatProxyRow(row), test: result });
  } catch (err) {
    console.error('Test proxy failed:', err?.message || err);
    res.status(500).json({ error: 'Proxy test failed' });
  }
});

module.exports = router;
