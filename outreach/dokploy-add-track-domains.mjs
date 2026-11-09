#!/usr/bin/env node
// Adds the open/click tracking hosts to the Dokploy "Emails" compose service and
// redeploys so Dokploy writes the new Traefik labels (compose domains are labels,
// they only take effect on the next deployment).
//
// postal-web listens on :5000 and serves /img/<server>/<message> for postal's
// tracking pixels, so every track.<sending-domain> host must route there.
//
// Usage: node dokploy-add-track-domains.mjs [--dry-run] [--no-deploy]

import { trpc } from "./dokploy-api.mjs";

const COMPOSE_ID = process.env.COMPOSE_ID || "IvKjY_jrGbRg1bE6IMg7v";
const SERVICE = "postal-web";
const PORT = 5000;

const HOSTS = [
  "track.getorewire.com",
  "track.orewiredata.com",
  "track.orewirehq.com",
];

const dryRun = process.argv.includes("--dry-run");
const noDeploy = process.argv.includes("--no-deploy");

const log = (...a) => console.log(...a);

function describe(d) {
  return `${d.host} -> ${d.serviceName}:${d.port} (${d.certificateType}, enabled=${d.enabled})`;
}

async function main() {
  const existing = await trpc("GET", "domain.byComposeId", { composeId: COMPOSE_ID });
  log(`existing domains (${existing.length}):`);
  for (const d of existing) log(`  - ${describe(d)}`);

  const byHost = new Map(existing.map((d) => [d.host, d]));
  const wanted = HOSTS.filter((h) => !byHost.has(h));
  if (wanted.length === 0) {
    log("\nAll track domains already present — nothing to create.");
  } else {
    log(`\ncreating ${wanted.length} domain(s): ${wanted.join(", ")}`);
    for (const host of wanted) {
      const payload = {
        host,
        path: "/",
        internalPath: "/",
        port: PORT,
        https: true,
        certificateType: "letsencrypt",
        domainType: "compose",
        composeId: COMPOSE_ID,
        serviceName: SERVICE,
        stripPath: false,
        customEntrypoint: null,
        middlewares: [],
        forwardAuthEnabled: false,
        enabled: true,
      };
      if (dryRun) {
        log(`  [dry-run] would create ${host}`);
        continue;
      }
      try {
        const created = await trpc("POST", "domain.create", payload);
        log(`  + ${describe(created)}  (domainId=${created.domainId})`);
      } catch (e) {
        if (/already exists|duplicate/i.test(String(e.message))) {
          log(`  = ${host} already exists (server-side)`);
        } else {
          throw e;
        }
      }
    }
  }

  const after = await trpc("GET", "domain.byComposeId", { composeId: COMPOSE_ID });
  log(`\nnow ${after.length} domains on ${SERVICE}:`);
  for (const d of after.filter((x) => x.serviceName === SERVICE)) log(`  - ${describe(d)}`);

  if (dryRun) return;
  if (noDeploy) {
    log("\n--no-deploy: skipping redeploy (labels only change after a deployment).");
    return;
  }

  log(`\nredeploying compose service ${COMPOSE_ID} ...`);
  const deployed = await trpc("POST", "compose.deploy", { composeId: COMPOSE_ID });
  log(`deploy response: ${JSON.stringify(deployed)}`);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
