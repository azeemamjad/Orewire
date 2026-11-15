#!/usr/bin/env node
// Stage 3: push the enriched 2026-11-12 leads into Listmonk as subscribers.
//
//   node import_listmonk.mjs [--dry-run] [--only AU|CA] [--limit N]
//
// Creates a per-country batch of lists so the new leads never mix with the
// already-mailed Oct batch:
//   AU Leads 11-12 / AU Research 11-12 / AU IR 11-12
//   CA Leads 11-12 / CA Research 11-12 / CA IR 11-12
//
// Subscriber attribs carry what the campaign template needs
// ({{ .Subscriber.Attribs.company_name }} etc.) plus the provenance of the
// address so a bad batch can be traced back.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lm } from "./lm_api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const ONLY = (() => {
  const i = argv.indexOf("--only");
  return i >= 0 ? argv[i + 1] : null;
})();
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? Number(argv[i + 1]) : 0;
})();

const BATCH = "11-12";
const OWN_DOMAIN = /@(?:orewire|getorewire|orewiredata|orewirehq)\.(?:com|co)$/i;
const OK_SOURCES = new Set(["published", "crawled", "crawled-fuzzy", "verified-pattern", "catchall-pattern", "generic", "generic-csv"]);
const PLACEHOLDER = /^(prior|general|authoris|authoriz|responsibilit|n\/?a|na|tbc|tba|unknown|unavailable|not|available|name|first|last|none|nil|pending)$/i;

const leads = JSON.parse(fs.readFileSync(path.join(HERE, "enriched.json"), "utf8"));

function countryKey(lead) {
  const c = String(lead.country || "").toLowerCase();
  if (c.includes("australia")) return "AU";
  if (c.includes("canada")) return "CA";
  return null;
}

function usable(lead) {
  if (!lead.email || !lead.email.includes("@")) return "no-email";
  if (!OK_SOURCES.has(lead.source)) return "source:" + lead.source;
  if (OWN_DOMAIN.test(lead.email)) return "own-domain";
  if (PLACEHOLDER.test(String(lead.first || "").trim()) || PLACEHOLDER.test(String(lead.last || "").trim())) return "placeholder-name";
  if (!countryKey(lead)) return "no-country";
  return null;
}

// ---------------------------------------------------------------- selection
const seen = new Set();
const selected = [];
const rejects = {};
for (const lead of leads) {
  const why = usable(lead);
  if (why) {
    rejects[why] = (rejects[why] || 0) + 1;
    continue;
  }
  if (ONLY && countryKey(lead) !== ONLY) continue;
  const key = lead.email.toLowerCase();
  if (seen.has(key)) {
    rejects["duplicate-email"] = (rejects["duplicate-email"] || 0) + 1;
    continue;
  }
  seen.add(key);
  selected.push(lead);
}
const limited = LIMIT > 0 ? selected.slice(0, LIMIT) : selected;

console.log(`[import] candidates=${leads.length} selected=${limited.length} rejects=${JSON.stringify(rejects)}`);
const bySource = {};
const byCountry = {};
for (const l of limited) {
  bySource[l.source] = (bySource[l.source] || 0) + 1;
  const ck = countryKey(l);
  byCountry[ck] = (byCountry[ck] || 0) + 1;
}
console.log("[import] by source:", bySource);
console.log("[import] by country:", byCountry);

if (DRY) {
  console.log("[import] dry run â€” no writes");
  process.exit(0);
}

// ---------------------------------------------------------------- lists
const LIST_NAMES = [];
for (const cc of ["AU", "CA"]) {
  LIST_NAMES.push(`${cc} Leads ${BATCH}`, `${cc} Research ${BATCH}`, `${cc} IR ${BATCH}`, `${cc} Catchall ${BATCH}`);
}

async function ensureLists() {
  const r = await lm("GET", "/api/lists?per_page=200");
  const existing = new Map(((r.json && r.json.data && r.json.data.results) || []).map((l) => [l.name, l.id]));
  const ids = {};
  for (const name of LIST_NAMES) {
    if (existing.has(name)) {
      ids[name] = existing.get(name);
      continue;
    }
    const c = await lm("POST", "/api/lists", { name, type: "private", optin: "single" });
    if (c.status === 200 && c.json && c.json.data) {
      ids[name] = c.json.data.id;
      console.log(`[import] created list "${name}" id=${c.json.data.id}`);
    } else {
      throw new Error(`list create failed for ${name}: HTTP ${c.status} ${c.text.slice(0, 200)}`);
    }
  }
  return ids;
}

const listIds = await ensureLists();

// ---------------------------------------------------------------- subscribers
function subscriberFor(lead) {
  const cc = countryKey(lead);
  const seg = lead.segment === "research" ? "Research" : "IR";
  const isCatchall = lead.source === "catchall-pattern";
  // Catch-all guesses are unverifiable by definition, so they land in their own
  // list instead of the campaign segment lists â€” the campaign must not send to
  // an address we could not confirm.
  const lists = isCatchall
    ? [listIds[`${cc} Leads ${BATCH}`], listIds[`${cc} Catchall ${BATCH}`]]
    : [listIds[`${cc} Leads ${BATCH}`], listIds[`${cc} ${seg} ${BATCH}`]];
  return {
    email: lead.email.toLowerCase(),
    name: `${lead.first} ${lead.last}`.trim(),
    status: "enabled",
    preconfirm_subscriptions: true,
    lists: lists.filter(Boolean),
    attribs: {
      company_name: lead.company,
      company: lead.company,
      title: lead.title,
      ticker: lead.ticker,
      exchange: lead.exchange,
      country: lead.country,
      city: lead.city,
      website: lead.website,
      segment: lead.segment,
      email_source: lead.source,
      email_confidence: lead.confidence,
      source_url: lead.source_url,
      batch: `2026-${BATCH}`,
    },
  };
}

async function findSubscriber(email) {
  const q = encodeURIComponent(`subscriber.email = '${email}'`);
  const r = await lm("GET", `/api/subscribers?query=${q}&per_page=5`);
  const results = (r.json && r.json.data && r.json.data.results) || [];
  return results.find((s) => s.email.toLowerCase() === email.toLowerCase()) || null;
}

let created = 0;
let updated = 0;
let failed = 0;
const failures = [];
const t0 = Date.now();

for (let i = 0; i < limited.length; i++) {
  const sub = subscriberFor(limited[i]);
  try {
    const r = await lm("POST", "/api/subscribers", sub);
    if (r.status === 200) {
      created++;
    } else if (r.status === 409) {
      const existing = await findSubscriber(sub.email);
      if (existing) {
        const mergedLists = [...new Set([...(existing.lists || []).map((l) => l.id), ...sub.lists])];
        const mergedAttribs = { ...(existing.attribs || {}), ...sub.attribs };
        const u = await lm("PUT", `/api/subscribers/${existing.id}`, {
          email: existing.email,
          name: sub.name || existing.name,
          status: "enabled",
          preconfirm_subscriptions: true,
          lists: mergedLists,
          attribs: mergedAttribs,
        });
        if (u.status === 200) updated++;
        else {
          failed++;
          failures.push(`${sub.email}: update HTTP ${u.status} ${u.text.slice(0, 120)}`);
        }
      } else {
        failed++;
        failures.push(`${sub.email}: 409 but not found`);
      }
    } else {
      failed++;
      failures.push(`${sub.email}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
    }
  } catch (e) {
    failed++;
    failures.push(`${sub.email}: ${String(e.message).slice(0, 120)}`);
  }
  if ((i + 1) % 25 === 0) {
    console.log(`[import] ${i + 1}/${limited.length} created=${created} updated=${updated} failed=${failed} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  }
}

console.log(`[import] DONE created=${created} updated=${updated} failed=${failed} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (failures.length) console.log("[import] first failures:", failures.slice(0, 8));

// ---------------------------------------------------------------- report
const after = await lm("GET", "/api/lists?per_page=200");
const counts = ((after.json && after.json.data && after.json.data.results) || [])
  .filter((l) => l.name.includes(BATCH))
  .map((l) => ({ id: l.id, name: l.name, subscribers: l.subscriber_count }));
console.log("[import] list counts:", JSON.stringify(counts, null, 1));
fs.writeFileSync(path.join(HERE, "import_report.json"), JSON.stringify({ created, updated, failed, failures: failures.slice(0, 50), counts, bySource, byCountry, at: new Date().toISOString() }, null, 2), "utf8");

