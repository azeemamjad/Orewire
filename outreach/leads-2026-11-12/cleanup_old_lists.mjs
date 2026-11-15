#!/usr/bin/env node
// After the person/company split the same subscribers also sit in the old
// "AU/CA IR 11-12" and "AU/CA Research 11-12" lists. Those campaigns are already
// finished, but leaving membership in place means a future campaign aimed at the
// old lists would mail everyone a second time. Keep the list records (campaign
// history) and remove the memberships.
//
//   node cleanup_old_lists.mjs [--dry-run]

import { lm } from "./lm_api.mjs";

const DRY = process.argv.includes("--dry-run");
const BATCH = "11-12";
const KEEP = new Set([
  `AU Leads ${BATCH}`, `CA Leads ${BATCH}`,
  `AU Person ${BATCH}`, `CA Person ${BATCH}`,
  `AU Company ${BATCH}`, `CA Company ${BATCH}`,
]);
const STRIP = new Set([`AU IR ${BATCH}`, `CA IR ${BATCH}`, `AU Research ${BATCH}`, `CA Research ${BATCH}`, `AU Catchall ${BATCH}`, `CA Catchall ${BATCH}`]);

const lists = (await lm("GET", "/api/lists?per_page=200")).json?.data?.results || [];
const byName = new Map(lists.map((l) => [l.name, l]));
const keepIds = new Set([...KEEP].map((n) => byName.get(n)?.id).filter(Boolean));
const stripIds = new Set([...STRIP].map((n) => byName.get(n)?.id).filter(Boolean));
console.log(`[cleanup] keep ids=${[...keepIds].join(",")} strip ids=${[...stripIds].join(",")}`);

let changed = 0;
let scanned = 0;
for (const cc of ["AU", "CA"]) {
  const leadsListId = byName.get(`${cc} Leads ${BATCH}`)?.id;
  if (!leadsListId) continue;
  for (let page = 1; page <= 20; page++) {
    const r = await lm("GET", `/api/subscribers?list_id=${leadsListId}&per_page=500&page=${page}`);
    const subs = r.json?.data?.results || [];
    for (const s of subs) {
      scanned++;
      const current = s.lists.map((l) => l.id).filter((id) => !stripIds.has(id));
      const merged = [...new Set([...current, ...s.lists.map((l) => l.id).filter((id) => keepIds.has(id))])];
      if (merged.length === s.lists.length) continue;
      if (DRY) {
        changed++;
        continue;
      }
      const u = await lm("PUT", `/api/subscribers/${s.id}`, {
        email: s.email,
        name: s.name,
        status: "enabled",
        preconfirm_subscriptions: true,
        lists: merged,
        attribs: s.attribs || {},
      });
      if (u.status === 200) changed++;
      else console.log(`[cleanup] failed ${s.email}: HTTP ${u.status}`);
    }
    if (subs.length < 500) break;
  }
}
console.log(`[cleanup] scanned=${scanned} ${DRY ? "would-change" : "changed"}=${changed}`);

const after = (await lm("GET", "/api/lists?per_page=200")).json?.data?.results || [];
for (const l of after.filter((x) => x.name.includes(BATCH))) {
  console.log(`   ${String(l.id).padStart(3)} ${l.name.padEnd(22)} ${l.subscriber_count}`);
}
