#!/usr/bin/env node
// Split the 2026-11-12 batch into two audiences and give each its own copy:
//
//   person  - addresses found for a named human (published/crawled/verified)
//             -> keeps the existing "Peer filings without the chase" step-1 copy
//   company - monitored company inboxes (ir@/info@)
//             -> new team-level template addressed to "team at <Company>"
//
// Listmonk already handed the whole batch to the console proxy, so the pending
// company messages have to be pulled back out of the proxy queue first
// (POST /api/queue-drop) — the queue stores rendered MIME and cannot be re-rendered.
//
//   node split_batch.mjs [--dry-run] [--start] [--skip-purge]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lm } from "./lm_api.mjs";
import { jsonRequest } from "./lib_https.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const START = argv.includes("--start");
const SKIP_PURGE = argv.includes("--skip-purge");

const BATCH = "11-12";
const CONSOLE = "https://emails-web.orewire.com";
const CONSOLE_COOKIE =
  "console_auth=" +
  crypto.createHmac("sha256", process.env.CONSOLE_PASSWORD || "XMoNeTB8hnCcWCfdNhw7")
    .update("orewire-console-session-v1")
    .digest("hex");

const PERSON_SOURCES = new Set(["published", "crawled", "crawled-fuzzy", "verified-pattern"]);
const COMPANY_SOURCES = new Set(["generic", "generic-csv"]);

// Team-level copy: no first name (the inbox is not a person), company name in the
// greeting and body, same offer and signature as the person-level step 1.
const COMPANY_BODY = `<p>Hi team at {{ .Subscriber.Attribs.company_name }},</p>
<p>I work on OreWire. We publish decoded filings and news summaries for 2,000+ mining companies on the TSX, TSX-V, CSE and ASX.</p>
<p>For IR and corp-dev teams the useful part is a peer watchlist: see what comparable issuers filed or released, without refreshing SEDAR and the ASX announcements page all day.</p>
<p>Would a peer-alert feed be useful at {{ .Subscriber.Attribs.company_name }}?</p>
<p>-- Azeem Amjad<br>OreWire</p>`;
const COMPANY_SUBJECT = "Peer filings for {{ .Subscriber.Attribs.company_name }}";
const FROM = "Azeem Amjad <hello@getorewire.com>";

const leads = JSON.parse(fs.readFileSync(path.join(HERE, "enriched.json"), "utf8"));

function countryKey(lead) {
  const c = String(lead.country || "").toLowerCase();
  if (c.includes("australia")) return "AU";
  if (c.includes("canada")) return "CA";
  return null;
}

// email -> { category, country, company }
const audience = new Map();
for (const l of leads) {
  if (!l.email || !l.email.includes("@")) continue;
  const cat = PERSON_SOURCES.has(l.source) ? "person" : COMPANY_SOURCES.has(l.source) ? "company" : null;
  const cc = countryKey(l);
  if (!cat || !cc) continue;
  const key = l.email.toLowerCase();
  if (audience.has(key)) continue;
  audience.set(key, { category: cat, country: cc, company: l.company, name: `${l.first} ${l.last}`.trim() });
}
const counts = {};
for (const [, v] of audience) counts[`${v.country} ${v.category}`] = (counts[`${v.country} ${v.category}`] || 0) + 1;
console.log(`[split] audience: ${JSON.stringify(counts)} total=${audience.size}`);

async function listsByName() {
  const r = await lm("GET", "/api/lists?per_page=200");
  return new Map(((r.json?.data?.results) || []).map((l) => [l.name, l]));
}
async function ensureList(name, existing) {
  if (existing.has(name)) return existing.get(name);
  if (DRY) {
    const fake = { id: -1, name, subscriber_count: 0 };
    existing.set(name, fake);
    return fake;
  }
  const r = await lm("POST", "/api/lists", { name, type: "private", optin: "single" });
  if (r.status !== 200) throw new Error(`list create ${name}: HTTP ${r.status} ${r.text.slice(0, 160)}`);
  console.log(`[split] created list "${name}" id=${r.json.data.id}`);
  return r.json.data;
}

let lists = await listsByName();
const listsOut = {};
for (const cc of ["AU", "CA"]) {
  for (const cat of ["Person", "Company"]) {
    listsOut[`${cc} ${cat}`] = await ensureList(`${cc} ${cat} ${BATCH}`, lists);
  }
}
lists = await listsByName();
const leadsList = {};
for (const cc of ["AU", "CA"]) {
  const l = lists.get(`${cc} Leads ${BATCH}`);
  if (!l) throw new Error(`missing ${cc} Leads ${BATCH} list`);
  leadsList[cc] = l;
}

// ---------------------------------------------------------------- move members
async function subscribersOfList(listId) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await lm("GET", `/api/subscribers?list_id=${listId}&per_page=500&page=${page}`);
    const results = r.json?.data?.results || [];
    out.push(...results);
    if (results.length < 500) break;
  }
  return out;
}

const moves = { person: 0, company: 0, unchanged: 0, failed: 0 };
const failures = [];
for (const cc of ["AU", "CA"]) {
  const subs = await subscribersOfList(leadsList[cc].id);
  console.log(`[split] ${cc}: ${subs.length} subscribers in "${leadsList[cc].name}"`);
  for (const s of subs) {
    const a = audience.get(String(s.email).toLowerCase());
    if (!a || a.country !== cc) {
      moves.unchanged++;
      continue;
    }
    const targetId = listsOut[`${cc} ${a.category === "person" ? "Person" : "Company"}`]?.id;
    if (!targetId) {
      moves.failed++;
      failures.push(`${s.email}: no target list`);
      continue;
    }
    const keepIds = (s.lists || []).map((l) => l.id).filter((id) => id !== listsOut[`${cc} Person`]?.id && id !== listsOut[`${cc} Company`]?.id);
    const merged = [...new Set([...keepIds, targetId])];
    const before = (s.lists || []).map((l) => l.id).sort().join(",");
    if (before === merged.sort().join(",")) {
      moves.unchanged++;
      continue;
    }
    if (DRY) {
      moves[a.category]++;
      continue;
    }
    const r = await lm("PUT", `/api/subscribers/${s.id}`, {
      email: s.email,
      name: s.name,
      status: "enabled",
      preconfirm_subscriptions: true,
      lists: merged,
      attribs: s.attribs || {},
    });
    if (r.status === 200) moves[a.category]++;
    else {
      moves.failed++;
      failures.push(`${s.email}: HTTP ${r.status} ${r.text.slice(0, 100)}`);
    }
  }
}
console.log(`[split] moved person=${moves.person} company=${moves.company} unchanged=${moves.unchanged} failed=${moves.failed}`);
if (failures.length) console.log("[split] failures:", failures.slice(0, 5));

// ---------------------------------------------------------------- purge queue
const companyAddresses = [...audience.entries()].filter(([, v]) => v.category === "company").map(([k]) => k);
if (SKIP_PURGE) {
  console.log("[split] --skip-purge: console queue left untouched");
} else {
  const state = (await jsonRequest(`${CONSOLE}/api/state`, { headers: { cookie: CONSOLE_COOKIE }, timeoutMs: 60000 })).json;
  const before = state?.queue_len ?? 0;
  // First show what would go, then do it (same call shape, dryRun flag).
  const preview = (await jsonRequest(`${CONSOLE}/api/queue-drop`, {
    method: "POST",
    headers: { cookie: CONSOLE_COOKIE },
    json: { emails: companyAddresses, dryRun: true },
    timeoutMs: 90000,
  })).json;
  console.log(`[split] queue before=${before} would-drop=${preview?.dropped} (company addresses=${companyAddresses.length})`);
  if (!DRY && preview?.dropped) {
    const done = (await jsonRequest(`${CONSOLE}/api/queue-drop`, {
      method: "POST",
      headers: { cookie: CONSOLE_COOKIE },
      json: { emails: companyAddresses },
      timeoutMs: 120000,
    })).json;
    console.log(`[split] queue-drop applied: dropped=${done?.dropped} remaining=${done?.queue_len}`);
  }
}

// ---------------------------------------------------------------- campaigns
async function campaignsByName() {
  const r = await lm("GET", "/api/campaigns?per_page=200");
  return new Map(((r.json?.data?.results) || []).map((c) => [c.name, c]));
}

const fresh = await listsByName();
const created = [];
for (const cc of ["AU", "CA"]) {
  const list = fresh.get(`${cc} Company ${BATCH}`);
  if (!list || !list.subscriber_count) {
    console.log(`[split] ${cc} Company ${BATCH}: no subscribers, skipping campaign`);
    continue;
  }
  const name = `B2 ${cc} Company inbox - Step 1 (${BATCH})`;
  const existing = await campaignsByName();
  if (existing.has(name)) {
    const c = existing.get(name);
    console.log(`[split] = ${name} exists (id ${c.id}, status ${c.status}, ${c.sent}/${c.to_send})`);
    created.push(c);
    continue;
  }
  if (DRY) {
    console.log(`[split] would create ${name} -> "${list.name}" (${list.subscriber_count} recipients)`);
    continue;
  }
  const r = await lm("POST", "/api/campaigns", {
    name,
    subject: COMPANY_SUBJECT,
    lists: [list.id],
    from_email: FROM,
    type: "regular",
    content_type: "html",
    body: COMPANY_BODY,
    template_id: 1,
    messenger: "email",
    headers: [],
    tags: [`batch-${BATCH}`, cc, "company-inbox"],
    send_at: null,
  });
  if (r.status !== 200) {
    console.log(`[split] campaign create failed ${name}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
    continue;
  }
  const c = r.json.data;
  created.push(c);
  console.log(`[split] + ${name} (id ${c.id}, ${list.subscriber_count} recipients)`);
}

if (START) {
  for (const c of created) {
    if (!c || ["running", "finished"].includes(c.status)) {
      console.log(`[split] = ${c?.name} already ${c?.status}`);
      continue;
    }
    const r = await lm("PUT", `/api/campaigns/${c.id}/status`, { status: "running" });
    console.log(`[split] started ${c.name} -> HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
} else if (created.length) {
  console.log("[split] company campaigns created as drafts — add --start to release them");
}

const finalLists = await listsByName();
const summary = ["AU Person", "CA Person", "AU Company", "CA Company"].map((k) => {
  const name = `${k} ${BATCH}`;
  return { list: name, subscribers: finalLists.get(name)?.subscriber_count ?? null };
});
console.log("[split] final lists:", JSON.stringify(summary, null, 1));
fs.writeFileSync(
  path.join(HERE, "split_report.json"),
  JSON.stringify({ audience: counts, moves, purged: SKIP_PURGE ? null : true, summary, started: START, at: new Date().toISOString() }, null, 2),
  "utf8",
);
