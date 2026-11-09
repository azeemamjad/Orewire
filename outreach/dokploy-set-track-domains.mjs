#!/usr/bin/env node
// Points the track.<sending-domain> Dokploy domains at the `track-proxy` nginx
// service (port 80) instead of postal-web, so requests reach Postal with
// `X-Postal-Track-Host: 1` and are handled by TrackingMiddleware (pixel + link
// clicks) rather than Rails' host authorization (bare 403).
//
// Usage: node dokploy-set-track-domains.mjs [--dry-run]

import { trpc } from "./dokploy-api.mjs";

const COMPOSE_ID = process.env.COMPOSE_ID || "IvKjY_jrGbRg1bE6IMg7v";
const TARGET = { serviceName: "track-proxy", port: 80 };
const HOSTS = ["track.getorewire.com", "track.orewiredata.com", "track.orewirehq.com"];

const dryRun = process.argv.includes("--dry-run");
const log = (...a) => console.log(...a);

async function main() {
  const domains = await trpc("GET", "domain.byComposeId", { composeId: COMPOSE_ID });
  const updates = [];

  for (const host of HOSTS) {
    const d = domains.find((x) => x.host === host);
    if (!d) {
      log(`! ${host}: domain record missing — run dokploy-add-track-domains.mjs first`);
      continue;
    }
    if (d.serviceName === TARGET.serviceName && d.port === TARGET.port) {
      log(`= ${host}: already -> ${d.serviceName}:${d.port}`);
      continue;
    }
    log(`~ ${host}: ${d.serviceName}:${d.port} -> ${TARGET.serviceName}:${TARGET.port}`);
    updates.push(d);
  }

  if (dryRun) {
    log(`\n[dry-run] would update ${updates.length} domain(s)`);
    return;
  }

  for (const d of updates) {
    // domain.update validates the whole record, so send the current values back
    // with only serviceName/port overridden.
    await trpc("POST", "domain.update", {
      domainId: d.domainId,
      host: d.host,
      path: d.path ?? "/",
      internalPath: d.internalPath ?? "/",
      https: d.https,
      certificateType: d.certificateType,
      domainType: d.domainType,
      composeId: d.composeId,
      stripPath: d.stripPath ?? false,
      customEntrypoint: d.customEntrypoint ?? null,
      middlewares: d.middlewares ?? [],
      forwardAuthEnabled: d.forwardAuthEnabled ?? false,
      enabled: d.enabled ?? true,
      serviceName: TARGET.serviceName,
      port: TARGET.port,
    });
    log(`  updated ${d.host}`);
  }

  const after = await trpc("GET", "domain.byComposeId", { composeId: COMPOSE_ID });
  log("\nfinal routing table:");
  for (const d of after) log(`  - ${d.host} -> ${d.serviceName}:${d.port} (${d.certificateType})`);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
