#!/usr/bin/env node
// Stage 4: create the 2026-11-12 batch campaigns in Listmonk from the copy that
// the October batch used (research angle vs IR angle), pointed at the fresh
// batch lists only.
//
//   node create_campaigns.mjs [--start] [--batch 11-12]
//
// Without --start the campaigns stay drafts so the recipient counts can be
// reviewed first. Sending is paced downstream: Listmonk -> console:2526 ->
// rotated mailboxes (5/day each) -> Postal, so a "running" campaign just fills
// the console queue and drains at 45/day.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lm } from "./lm_api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const START = argv.includes("--start");
const BATCH = (() => {
  const i = argv.indexOf("--batch");
  return i >= 0 ? argv[i + 1] : "11-12";
})();

const BODY_RESEARCH = `<p>Hi {{ .Subscriber.FirstName }},</p>
<p>I work on OreWire. We decode TSX, TSX-V, CSE and ASX mining filings and news for 2,000+ issuers so research teams don't have to dig through SEDAR and ASX each morning.</p>
<p>Curious if {{ .Subscriber.Attribs.company_name }} still pulls filings the hard way, or if a watchlist + alert feed would save your team time?</p>
<p>Happy to send a 2-minute walkthrough if useful.</p>
<p>-- Azeem Amjad<br>OreWire</p>`;

const BODY_IR = `<p>Hi {{ .Subscriber.FirstName }},</p>
<p>I work on OreWire. We publish decoded filings and news summaries for 2,000+ mining companies on the TSX, TSX-V, CSE and ASX.</p>
<p>For IR and corp-dev teams, the useful part is a peer watchlist: see what comparable issuers filed or released, without refreshing SEDAR all day.</p>
<p>Would a peer-alert feed be useful at {{ .Subscriber.Attribs.company_name }}?</p>
<p>-- Azeem Amjad<br>OreWire</p>`;

const SUBJECT_RESEARCH = "Filing noise on the TSX-V";
const SUBJECT_IR = "Peer filings without the chase";
const FROM = "Azeem Amjad <hello@getorewire.com>";

async function listsByName() {
  const r = await lm("GET", "/api/lists?per_page=200");
  const out = new Map();
  for (const l of (r.json && r.json.data && r.json.data.results) || []) out.set(l.name, l);
  return out;
}

async function existingCampaigns() {
  const r = await lm("GET", "/api/campaigns?per_page=200");
  const out = new Map();
  for (const c of (r.json && r.json.data && r.json.data.results) || []) out.set(c.name, c);
  return out;
}

const lists = await listsByName();
const campaigns = await existingCampaigns();

const plans = [];
for (const cc of ["AU", "CA"]) {
  const ir = lists.get(`${cc} IR ${BATCH}`);
  const research = lists.get(`${cc} Research ${BATCH}`);
  if (ir && ir.subscriber_count > 0) {
    plans.push({ cc, segment: "IR", list: ir, subject: SUBJECT_IR, body: BODY_IR });
  }
  if (research && research.subscriber_count >= 15) {
    plans.push({ cc, segment: "Research", list: research, subject: SUBJECT_RESEARCH, body: BODY_RESEARCH });
  }
}

console.log("[campaign] plan:");
for (const p of plans) console.log(`  - ${p.cc} ${p.segment}: list "${p.list.name}" (${p.list.subscriber_count} subscribers) — subject "${p.subject}"`);
if (!plans.length) {
  console.log("[campaign] nothing to create (no populated batch lists)");
  process.exit(0);
}

const created = [];
for (const p of plans) {
  const name = `B1 ${p.cc} ${p.segment} - Step 1 (${BATCH})`;
  if (campaigns.has(name)) {
    const c = campaigns.get(name);
    console.log(`[campaign] = ${name} already exists (id ${c.id}, status ${c.status}, sent ${c.sent}/${c.to_send})`);
    created.push(c);
    continue;
  }
  const payload = {
    name,
    subject: p.subject,
    lists: [p.list.id],
    from_email: FROM,
    type: "regular",
    content_type: "html",
    body: p.body,
    template_id: 1,
    messenger: "email",
    headers: [],
    tags: [`batch-${BATCH}`, p.cc, p.segment.toLowerCase()],
    send_at: null,
  };
  const r = await lm("POST", "/api/campaigns", payload);
  if (r.status !== 200 || !r.json || !r.json.data) {
    console.log(`[campaign] FAILED ${name}: HTTP ${r.status} ${r.text.slice(0, 220)}`);
    continue;
  }
  const c = r.json.data;
  created.push(c);
  console.log(`[campaign] + ${name} (id ${c.id}, ${p.list.subscriber_count} recipients) status=${c.status}`);
}

if (START) {
  for (const c of created) {
    if (!c || c.status === "running" || c.status === "finished") {
      console.log(`[campaign] = ${c && c.name} already ${c && c.status}`);
      continue;
    }
    const r = await lm("PUT", `/api/campaigns/${c.id}/status`, { status: "running" });
    console.log(`[campaign] start ${c.name} -> HTTP ${r.status} ${(r.text || "").slice(0, 120)}`);
    await new Promise((res) => setTimeout(res, 1200));
  }
} else {
  console.log("\n[campaign] drafts created — review recipient counts, then re-run with --start");
}

fs.writeFileSync(
  path.join(HERE, "campaigns_report.json"),
  JSON.stringify(
    {
      plans: plans.map((p) => ({ cc: p.cc, segment: p.segment, list: p.list.name, recipients: p.list.subscriber_count })),
      created: created.map((c) => ({ id: c.id, name: c.name, status: c.status, to_send: c.to_send })),
      started: START,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
  "utf8",
);
