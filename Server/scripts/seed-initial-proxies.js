#!/usr/bin/env node
/**
 * One-time seed: reads PROXY_* from .env into browser_proxies, then remove those vars.
 *   node scripts/seed-initial-proxies.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db');
const { parseHostPort, residentialUsername } = require('../relay/proxy-store');

const DC_PORTS = [8001, 8002, 8003, 8004, 8005];

async function main() {
  const existing = await db.query(`SELECT COUNT(*)::int AS n FROM browser_proxies`);
  if ((existing.rows[0]?.n || 0) > 0) {
    console.log('[seed] browser_proxies already has rows — skipping');
    await db.end();
    return;
  }

  const dcUser = process.env.PROXY_USERNAME;
  const dcPass = process.env.PROXY_PASSWORD;
  const resUser = process.env.PROXY_USERNAME_2 || process.env.PrOXY_USERNAME_2;
  const resPass = process.env.PROXY_PASSWORD_2;
  const resServer = process.env.PROXY_SERVER_2 || process.env.Proxy_Server_2 || 'pr.oxylabs.io:7777';

  if (!dcUser || !dcPass) {
    console.error('[seed] PROXY_USERNAME and PROXY_PASSWORD required in .env for datacenter seed');
    process.exit(1);
  }

  const dcBase = process.env.PROXY_SERVER || 'http://dc.oxylabs.io';
  const { host: dcHost } = parseHostPort(dcBase, null);
  const host = dcHost || 'dc.oxylabs.io';

  for (let i = 0; i < DC_PORTS.length; i++) {
    await db.query(
      `INSERT INTO browser_proxies (name, tier, host, port, username, password, sort_order)
       VALUES ($1, 'datacenter', $2, $3, $4, $5, $6)`,
      [`Oxylabs DC :${DC_PORTS[i]}`, host, DC_PORTS[i], dcUser, dcPass, i],
    );
    console.log(`[seed] + datacenter ${host}:${DC_PORTS[i]}`);
  }

  if (resUser && resPass) {
    const { host: resHost, port: resPort } = parseHostPort(resServer, 7777);
    await db.query(
      `INSERT INTO browser_proxies (name, tier, host, port, username, password, sessid, sort_order)
       VALUES ($1, 'residential', $2, $3, $4, $5, $6, $7)`,
      [
        `Oxylabs RES :${resPort}`,
        resHost || 'pr.oxylabs.io',
        resPort,
        resUser,
        resPass,
        'relayres1',
        10,
      ],
    );
    console.log(`[seed] + residential ${resHost || 'pr.oxylabs.io'}:${resPort} (sessid relayres1)`);
  } else {
    console.warn('[seed] Skipping residential — PROXY_USERNAME_2 / PROXY_PASSWORD_2 not set');
  }

  console.log('\n[seed] Done. Remove PROXY_* / USE_PROXY / RELAY_*_COUNT from .env and restart the server.');
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
