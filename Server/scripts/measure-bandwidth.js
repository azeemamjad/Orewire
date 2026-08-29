#!/usr/bin/env node
/**
 * Measure what a scrape actually costs in proxy bytes.
 *
 *   node scripts/measure-bandwidth.js --flow sedar
 *   node scripts/measure-bandwidth.js --flow sedar --cold     # ignore the profile cache
 *   node scripts/measure-bandwidth.js --url https://…
 *
 * Reports *wire* bytes (post-compression, via CDP `encodedDataLength`), split by
 * resource type and by host, plus what the persistent profile's cache served for
 * free. Chromium engines only — the numbers come from CDP.
 */
require('dotenv').config();

const { launchSession, profileDirFor, resetProfile } = require('../relay/engines');
const { resolveRelayHeadless } = require('../relay/env');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function hostOf(url) {
  try { return new URL(url).host; } catch { return '(unknown)'; }
}

/** Track wire bytes per request via CDP. */
function attachMeter(cdp) {
  const byId = new Map();
  const stats = {
    total: 0,
    cached: 0,
    cachedCount: 0,
    byType: new Map(),
    byHost: new Map(),
    requests: 0,
    blocked: 0,
  };

  const bump = (map, key, bytes) => {
    const cur = map.get(key) || { bytes: 0, count: 0 };
    cur.bytes += bytes;
    cur.count += 1;
    map.set(key, cur);
  };

  cdp.on('Network.requestWillBeSent', (p) => {
    stats.requests += 1;
    byId.set(p.requestId, { url: p.request.url, type: p.type || 'Other' });
  });
  cdp.on('Network.responseReceived', (p) => {
    const r = byId.get(p.requestId);
    if (r) {
      r.type = p.type || r.type;
      r.fromCache = !!p.response.fromDiskCache;
      r.contentLength = Number(p.response.headers?.['content-length'] || 0);
    }
  });
  cdp.on('Network.loadingFinished', (p) => {
    const r = byId.get(p.requestId);
    if (!r) return;
    const bytes = p.encodedDataLength || 0;
    if (r.fromCache) {
      // Served from the profile's disk cache — cost us nothing on the proxy.
      stats.cached += r.contentLength || 0;
      stats.cachedCount += 1;
      return;
    }
    stats.total += bytes;
    bump(stats.byType, r.type, bytes);
    bump(stats.byHost, hostOf(r.url), bytes);
  });
  cdp.on('Network.loadingFailed', (p) => {
    const r = byId.get(p.requestId);
    if (r && p.blockedReason) stats.blocked += 1;
  });

  return stats;
}

function report(label, stats, targetHost) {
  console.log(`\n=== ${label} ===`);
  console.log(`total on the wire : ${mb(stats.total)}  (${stats.requests} requests)`);
  if (stats.cachedCount) {
    console.log(`served from cache : ${mb(stats.cached)} across ${stats.cachedCount} requests — free`);
  }
  if (stats.blocked) console.log(`blocked           : ${stats.blocked} requests`);

  const rows = [...stats.byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  console.log('\nby resource type:');
  for (const [type, v] of rows) {
    const pct = stats.total ? ((v.bytes / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${String(type).padEnd(14)} ${kb(v.bytes).padStart(11)}  ${String(pct).padStart(5)}%  (${v.count})`);
  }

  const hosts = [...stats.byHost.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 12);
  console.log('\ntop hosts:');
  let thirdParty = 0;
  for (const [host, v] of stats.byHost) {
    if (targetHost && !host.endsWith(targetHost)) thirdParty += v.bytes;
  }
  for (const [host, v] of hosts) {
    const tag = targetHost && !host.endsWith(targetHost) ? ' (3rd party)' : '';
    console.log(`  ${host.padEnd(34)} ${kb(v.bytes).padStart(11)}  (${v.count})${tag}`);
  }
  if (targetHost) {
    const pct = stats.total ? ((thirdParty / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`\nthird-party total : ${mb(thirdParty)}  (${pct}% of the bill)`);
  }
  return stats.total;
}

async function runSedarFlow(page) {
  const pause = (a, b) => page.waitForTimeout(a + Math.floor(Math.random() * (b - a)));
  await page.goto('https://www.sedarplus.ca/home/', { waitUntil: 'load', timeout: 90000 });
  await pause(800, 1500);
  const l1 = page.getByRole('link', { name: /search sedar/i }).first();
  await l1.waitFor({ state: 'visible', timeout: 20000 });
  await l1.click();
  await pause(600, 1200);
  const l2 = page.getByRole('link', { name: /^documents$/i }).first();
  await l2.waitFor({ state: 'visible', timeout: 20000 });
  await l2.click();
  await page.waitForSelector('input[placeholder="Profile name or number"]', {
    state: 'visible', timeout: 40000,
  });
  await page.waitForTimeout(2000);
}

(async () => {
  const workerId = arg('worker', 'bandwidth-probe');
  if (arg('cold')) {
    resetProfile(workerId);
    console.log(`Cold run — cleared ${profileDirFor(workerId)}`);
  }

  const session = await launchSession({
    workerId,
    proxy: null,
    headless: resolveRelayHeadless(),
  });
  if (!session.cdp) {
    console.error('This measurement needs CDP — run with RELAY_ENGINE=chrome.');
    process.exit(2);
  }

  await session.cdp.send('Network.enable');
  const stats = attachMeter(session.cdp);

  try {
    const url = arg('url');
    if (arg('flow') === 'sedar') {
      await runSedarFlow(session.page);
      report('SEDAR+ search flow', stats, 'sedarplus.ca');
    } else if (url && url !== true) {
      await session.page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await session.page.waitForTimeout(3000);
      report(url, stats, hostOf(url));
    } else {
      console.error('Pass --flow sedar or --url <target>');
      process.exit(2);
    }
  } finally {
    await session.context.close().catch(() => {});
  }
  console.log('');
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
