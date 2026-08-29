#!/usr/bin/env node
/**
 * Turn "net::ERR_TUNNEL_CONNECTION_FAILED" into an actual reason.
 *
 *   npm run relay:diagnose-proxies
 *
 * Chrome collapses every CONNECT failure into one opaque error. This talks to
 * the proxy directly and prints the status line it actually returns, which
 * separates the cases that look identical from inside the browser:
 *
 *   TCP refused / timeout      → proxy host or port is wrong, or it is down
 *   407                        → credentials rejected (username format, sessid, password)
 *   402 / 403 / "limit"        → account out of bandwidth or suspended
 *   200 Connection established → the proxy is fine; the problem is elsewhere
 *
 * Runs against every enabled proxy in the DB, so it also answers "is it this one
 * proxy or all of them".
 */
require('dotenv').config();
const net = require('net');
const tls = require('tls');

const store = require('../relay/proxy-store');

const TARGET_HOST = process.env.PROXY_DIAG_HOST || 'www.sedarplus.ca';
const TARGET_PORT = 443;
const TIMEOUT_MS = parseInt(process.env.PROXY_DIAG_TIMEOUT_MS || '15000', 10);

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;

function parseHostPort(server) {
  const bare = String(server || '').replace(/^https?:\/\//, '');
  const i = bare.lastIndexOf(':');
  return i > 0
    ? { host: bare.slice(0, i), port: parseInt(bare.slice(i + 1), 10) }
    : { host: bare, port: 80 };
}

/** Raw CONNECT through the proxy — returns the proxy's own status line. */
function connectThroughProxy({ host, port, username, password }, withAuth = true) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve({ ...r, ms: Date.now() - started });
    };

    const socket = net.connect({ host, port });
    socket.setTimeout(TIMEOUT_MS);

    socket.on('connect', () => {
      let req = `CONNECT ${TARGET_HOST}:${TARGET_PORT} HTTP/1.1\r\n`
        + `Host: ${TARGET_HOST}:${TARGET_PORT}\r\n`;
      if (withAuth && username) {
        const b64 = Buffer.from(`${username}:${password || ''}`).toString('base64');
        req += `Proxy-Authorization: Basic ${b64}\r\n`;
      }
      req += 'Proxy-Connection: keep-alive\r\n\r\n';
      socket.write(req);
    });

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      const head = buf.slice(0, buf.indexOf('\r\n\r\n'));
      const status = head.split('\r\n')[0] || '';
      const code = parseInt((status.match(/\s(\d{3})\s/) || [])[1], 10) || 0;
      done({ ok: code === 200, code, status, head, socket: null });
    });

    socket.on('timeout', () => done({ ok: false, code: 0, status: `timeout after ${TIMEOUT_MS}ms` }));
    socket.on('error', (err) => done({ ok: false, code: 0, status: `${err.code || err.message}` }));
  });
}

/** Once the tunnel is open, confirm real traffic flows and report the exit IP. */
function exitIpThroughProxy({ host, port, username, password }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const socket = net.connect({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.on('timeout', () => { socket.destroy(); done(null); });
    socket.on('error', () => done(null));
    socket.on('connect', () => {
      // ip-api's free tier is HTTP-only and answers HTTPS with an empty body,
      // so read the exit IP from a host that actually serves TLS.
      let req = 'CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n';
      if (username) {
        const b64 = Buffer.from(`${username}:${password || ''}`).toString('base64');
        req += `Proxy-Authorization: Basic ${b64}\r\n`;
      }
      req += '\r\n';
      socket.write(req);
    });
    let phase = 'connect';
    let buf = '';
    socket.on('data', (chunk) => {
      if (phase === 'connect') {
        buf += chunk.toString('latin1');
        if (!buf.includes('\r\n\r\n')) return;
        if (!/\s200\s/.test(buf.split('\r\n')[0])) { socket.destroy(); return done(null); }
        phase = 'tls';
        const secure = tls.connect({ socket, servername: 'api.ipify.org' }, () => {
          secure.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
        });
        let body = '';
        secure.on('data', (d) => { body += d.toString('utf8'); });
        secure.on('end', () => {
          const m = body.match(/\{[^{}]*"ip"[^{}]*\}/);
          done(m ? m[0] : null);
        });
        secure.on('error', () => done(null));
      }
    });
  });
}

(async () => {
  await store.refreshProxyCache().catch((e) => {
    console.error(`Could not read proxies from the DB: ${e.message}`);
    process.exit(2);
  });

  const rows = store.getCachedProxies().filter((p) => p.enabled);
  if (!rows.length) {
    console.error('No enabled proxies in the DB (Admin → Proxies).');
    process.exit(2);
  }

  console.log(`Testing ${rows.length} enabled prox${rows.length === 1 ? 'y' : 'ies'} `
    + `against ${TARGET_HOST}:${TARGET_PORT}\n`);

  let anyOk = false;
  for (const row of rows) {
    const p = store.rowToPlaywrightProxy(row);
    const { host, port } = parseHostPort(p.server);
    const masked = store.maskProxyForApi(p);
    console.log(`── ${row.name}  [${row.tier}]`);
    console.log(`   ${host}:${port}  user=${masked?.username || '(none)'}`);

    const withAuth = await connectThroughProxy({ host, port, username: p.username, password: p.password }, true);

    if (withAuth.ok) {
      anyOk = true;
      console.log(`   ${GREEN('OK')}  ${withAuth.status}  (${withAuth.ms}ms)`);
      const ip = await exitIpThroughProxy({ host, port, username: p.username, password: p.password });
      console.log(`   exit: ${ip || '(could not read)'}`);
    } else if (withAuth.code === 407) {
      console.log(`   ${RED('AUTH REJECTED')}  ${withAuth.status}`);
      const noAuth = await connectThroughProxy({ host, port }, false);
      console.log(`   without credentials: ${noAuth.status}`);
      console.log(`   ${YELLOW('→')} the proxy is reachable but refused these credentials.`);
      console.log('     Check the username format (Oxylabs residential needs customer-USER-sessid-XXX),');
      console.log('     the password, and whether the sessid is still alphanumeric.');
    } else if (withAuth.code === 402 || withAuth.code === 403 || /limit|quota|exceed|suspend/i.test(withAuth.head || '')) {
      console.log(`   ${RED('REFUSED')}  ${withAuth.status}`);
      console.log(`   ${YELLOW('→')} looks like an account problem: bandwidth exhausted or subscription suspended.`);
      if (withAuth.head) console.log(`   proxy said:\n     ${withAuth.head.split('\n').join('\n     ')}`);
    } else if (withAuth.code === 0) {
      console.log(`   ${RED('UNREACHABLE')}  ${withAuth.status}  (${withAuth.ms}ms)`);
      console.log(`   ${YELLOW('→')} host/port wrong, or the proxy is down / blocked by egress rules.`);
    } else {
      console.log(`   ${RED('FAILED')}  ${withAuth.status}`);
      if (withAuth.head) console.log(`   proxy said:\n     ${withAuth.head.split('\n').join('\n     ')}`);
    }
    console.log('');
  }

  if (!anyOk) {
    console.log(RED('No enabled proxy can open a tunnel — this is why every page.goto fails'));
    console.log('with net::ERR_TUNNEL_CONNECTION_FAILED. Chrome reports every one of the');
    console.log('cases above identically; the status lines here are the real reason.\n');
    process.exit(1);
  }
  console.log(GREEN('At least one proxy is healthy.\n'));
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });
