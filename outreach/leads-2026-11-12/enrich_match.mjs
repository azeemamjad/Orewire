#!/usr/bin/env node
// Stage 2 of the 2026-11-12 lead pipeline: turn crawled company-site emails plus
// person-name patterns into a mailing-ready email per lead, and verify every
// guessed address with the self-hosted Reacher service (via the console proxy,
// because this laptop cannot open outbound port 25).
//
//   node enrich_match.mjs [--verify] [--max-probes 1] [--concurrency 3]
//
// Outputs: enriched.csv, enrich_report.json, verify_cache.json
//
// Confidence ladder:
//   published        - email came in the source CSV (already sourced)
//   crawled          - exact person match found on the company site
//   verified-pattern - guessed pattern that Reacher says is deliverable
//   catchall-pattern - guessed pattern on a catch-all domain (Reacher "risky")
//   generic          - company-level address (ir@/info@), used only when no
//                      person-level address exists and only once per company

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonRequest } from "./lib_https.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEADS = JSON.parse(fs.readFileSync(path.join(HERE, "leads.json"), "utf8"));
const CRAWL_FILE = path.join(HERE, "crawl_results.jsonl");
const CACHE_FILE = path.join(HERE, "verify_cache.json");
const CONSOLE = "https://emails-web.orewire.com";
const CONSOLE_PASSWORD = process.env.CONSOLE_PASSWORD || "XMoNeTB8hnCcWCfdNhw7";
const COOKIE = "console_auth=" + crypto.createHmac("sha256", CONSOLE_PASSWORD).update("orewire-console-session-v1").digest("hex");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DO_VERIFY = argv.includes("--verify");
const MAX_PROBES = Number(arg("max-probes", 2));
const CONCURRENCY = Number(arg("concurrency", 3));
const BUDGET = Number(arg("budget", 0));
const SKIP_WITH_GENERIC = argv.includes("--skip-with-generic");
// Reuse whatever Reacher already told us without opening new SMTP connections.
const CACHE_ONLY = argv.includes("--from-cache-only");

const GENERIC_LOCAL = /^(info|contact|enquiries|enquiry|inquiries|hello|admin|office|sales|support|ir|investors|investor|investorrelations|corporate|company|general|mail|reception|accounts|media|team)$/i;

// The source CSV carries extraction artifacts in the name columns ("Prior
// Authorisation", "General Responsibilities", "N/A"...). Mailing those is
// guaranteed to bounce or look like spam, so drop them early.
const PLACEHOLDER = /^(prior|general|authoris|authoriz|responsibilit|n\/?a|na|tbc|tba|unknown|unavailable|not|available|name|first|last|none|nil|pending|director|secretary|chief|managing|executive|company|the)$/i;
function badName(lead) {
  const f = String(lead.first || "").trim();
  const l = String(lead.last || "").trim();
  if (!f || !l) return true;
  if (f.length < 2 || l.length < 2) return true;
  if (PLACEHOLDER.test(f) || PLACEHOLDER.test(l)) return true;
  if (/^(director|secretary|chief|officer|manager|executive|chair)/i.test(`${f} ${l}`)) return true;
  if (strip(f) === strip(l)) return true;
  return false;
}

// ------------------------------------------------------------------ helpers
const strip = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const PARTICLES = new Set(["de", "van", "von", "der", "di", "la", "le", "du", "da", "del"]);

function nameParts(lead) {
  const first = strip(lead.first);
  const lastTokens = String(lead.last || "")
    .split(/[\s\-]+/)
    .map(strip)
    .filter(Boolean);
  const last = lastTokens[lastTokens.length - 1] || "";
  const lastJoin = lastTokens.join("");
  return { first, last, lastJoin, lastTokens };
}

function patterns({ first, last, lastJoin }) {
  const f = first[0] || "";
  const l = last || "";
  const out = [
    `${f}${lastJoin}`,
    `${f}${l}`,
    first,
    `${first}.${lastJoin}`,
    `${first}.${l}`,
    `${f}.${l}`,
    `${first}${l}`,
    `${first}${lastJoin}`,
    `${l}.${first}`,
    `${first}_${l}`,
    `${l}${f}`,
  ];
  return [...new Set(out.filter((x) => x && x.length > 2))];
}

function domainOf(email) {
  return String(email).split("@")[1] || "";
}

// learned per-domain local-part style, e.g. andrew.buxton@ -> first.last
function classify(first, last, local) {
  const { first: f, last: l } = nameParts({ first, last });
  const lj = String(last).replace(/[^a-z]/gi, "").toLowerCase();
  const cand = {
    "first.last": `${f}.${l}`,
    flast: `${f[0]}${l}`,
    firstlast: `${f}${l}`,
    first: f,
    "f.last": `${f[0]}.${l}`,
    last: l,
    "last.first": `${l}.${f}`,
    "first_last": `${f}_${l}`,
  };
  for (const [k, v] of Object.entries(cand)) if (v === local) return k;
  return null;
}

// ------------------------------------------------------------------ inputs
const crawl = new Map();
if (fs.existsSync(CRAWL_FILE)) {
  for (const line of fs.readFileSync(CRAWL_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      crawl.set(r.domain, r);
    } catch {}
  }
}
console.log(`[match] leads=${LEADS.length} crawled domains=${crawl.size}`);

// Per-person email from the crawl (same-domain only).
function emailsFor(domain) {
  const rec = crawl.get(domain);
  if (!rec) return [];
  return (rec.emails || []).filter((e) => {
    const d = domainOf(e.email);
    return d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`);
  });
}

// Domain-level pattern votes from leads that already have a published email.
const domainVotes = new Map();
for (const lead of LEADS) {
  if (!lead.existing_email || !lead.domain) continue;
  const p = classify(lead.first, lead.last, String(lead.existing_email).split("@")[0]);
  if (!p) continue;
  const v = domainVotes.get(lead.domain) || {};
  v[p] = (v[p] || 0) + 1;
  domainVotes.set(lead.domain, v);
}

// ------------------------------------------------------------------ verify
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
let probes = 0;
let verifyFailures = 0;
let verifyDisabled = !DO_VERIFY;

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
}

async function verify(email) {
  const key = email.toLowerCase();
  if (cache[key]) return cache[key];
  if (verifyDisabled || CACHE_ONLY) return null;
  if (BUDGET > 0 && probes >= BUDGET) {
    verifyDisabled = true;
    console.log(`[match] probe budget (${BUDGET}) reached — stopping verification`);
    return null;
  }
  probes++;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await jsonRequest(`${CONSOLE}/api/verify-email`, {
        method: "POST",
        headers: { cookie: COOKIE },
        json: { email: key },
        timeoutMs: 70000,
      });
      if (r.status !== 200 || !r.json || !r.json.result) {
        verifyFailures++;
        if (verifyFailures >= 15) verifyDisabled = true;
        if (attempt === 2) return null;
        await new Promise((res) => setTimeout(res, 1500));
        continue;
      }
      const res = r.json.result;
      const smtp = res.smtp || {};
      const mx = res.mx || {};
      const rec = {
        reachable: res.is_reachable || "unknown",
        accepts_mail: mx.accepts_mail === true,
        catchall: smtp.is_catch_all === true,
        deliverable: smtp.is_deliverable === true,
        at: new Date().toISOString(),
      };
      cache[key] = rec;
      verifyFailures = 0;
      if (probes % 10 === 0) {
        saveCache();
        console.log(`[match] probes=${probes} cache=${Object.keys(cache).length}`);
      }
      return rec;
    } catch (e) {
      verifyFailures++;
      if (verifyFailures >= 15) verifyDisabled = true;
      if (attempt === 2) return null;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return null;
}

// ------------------------------------------------------------------ match
const usedEmails = new Set();
const results = [];
const stats = { published: 0, crawled: 0, crawledFuzzy: 0, verified: 0, catchall: 0, generic: 0, none: 0 };

// Signals for the generic fallback: prefer the person most likely to own an
// inbox at the company (IR / CFO / secretary roles first).
const GENERIC_OWNER = /investor relations|chief financial|\bcfo\b|company secretary|managing director|\bceo\b|chief executive|corporate development/i;

const leadsSorted = [...LEADS].sort((a, b) => {
  const rank = (l) => (GENERIC_OWNER.test(l.title) ? 0 : l.segment === "ir" ? 1 : 2);
  return rank(a) - rank(b) || a.idx - b.idx;
});

// Domain catch-all cache (once a domain answers catch-all, stop probing it).
const catchallDomains = new Set();
for (const [email, rec] of Object.entries(cache)) if (rec.catchall) catchallDomains.add(domainOf(email));

function chooseEmail(lead) {
  const { first } = nameParts(lead);
  const domain = lead.domain;
  if (!domain) return { email: "", source: "no-domain", confidence: "none", url: "" };

  // 1. already published
  if (lead.existing_email) return { email: lead.existing_email, source: "published", confidence: "high", url: lead.website };

  // 2. exact person match from the crawled company pages
  const list = emailsFor(domain);
  const cands = patterns(nameParts(lead));
  for (const e of list) {
    const local = e.email.split("@")[0];
    if (GENERIC_LOCAL.test(local)) continue;
    if (cands.includes(local) && !usedEmails.has(e.email)) {
      return { email: e.email, source: "crawled", confidence: "high", url: e.source || lead.website };
    }
  }

  // 2b. fuzzy: surname appears in the local part and so does the first name or
  // its initial ("john.smith", "smithj", "jsmith2", "john_smith")
  const np = nameParts(lead);
  if (np.last.length >= 4) {
    for (const e of list) {
      const local = e.email.split("@")[0];
      if (GENERIC_LOCAL.test(local)) continue;
      if (usedEmails.has(e.email)) continue;
      const hasLast = local.includes(np.last);
      const hasFirst = np.first.length >= 3 ? local.includes(np.first) : false;
      const hasInitial = local.startsWith(np.first[0]) || local.includes(`.${np.first[0]}`) || local.includes(`_${np.first[0]}`);
      if (hasLast && (hasFirst || hasInitial)) {
        return { email: e.email, source: "crawled-fuzzy", confidence: "medium", url: e.source || lead.website };
      }
    }
  }

  // 3. guessed pattern (verified later, in the async pass)
  return { email: "", source: "pattern-pending", confidence: "none", url: "", candidates: cands };
}

const pending = [];
const skippedNames = [];
for (const lead of leadsSorted) {
  if (badName(lead) && !lead.existing_email) {
    skippedNames.push(lead);
    results.push({ lead, email: "", source: "invalid-name", confidence: "none", url: "" });
    continue;
  }
  const c = chooseEmail(lead);
  if (c.source !== "pattern-pending") {
    if (c.email) usedEmails.add(c.email.toLowerCase());
    stats[c.source === "published" ? "published" : c.source === "crawled" ? "crawled" : "none"]++;
    results.push({ lead, ...c });
  } else {
    pending.push({ lead, candidates: c.candidates });
  }
}
console.log(`[match] published=${stats.published} crawled=${stats.crawled} pending-pattern=${pending.length}`);

// ------------------------------------------------------------------ guess + verify
const gap = 350;
let cursor = 0;

async function verifyWorker() {
  while (cursor < pending.length) {
    const item = pending[cursor++];
    const lead = item.lead;
    // Leads that already have a company inbox from the source CSV will fall back
    // to it anyway, so don't spend SMTP probes on them when a budget is set.
    if (SKIP_WITH_GENERIC && /@/.test(String(lead.generic_email || ""))) {
      results.push({ lead, email: "", source: "none", confidence: "none", url: "", tried: 0 });
      continue;
    }
    if (verifyDisabled && BUDGET > 0 && probes >= BUDGET) {
      results.push({ lead, email: "", source: "none", confidence: "none", url: "", tried: 0 });
      continue;
    }
    const np = nameParts(lead);
    const votes = domainVotes.get(lead.domain) || {};
    const hasParticles = np.lastTokens.length > 1;
    const ordered = [
      ...Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([k]) => k),
      ...(hasParticles
        ? ["flastjoin", "flast", "first.lastjoin", "first", "first.last", "f.last"]
        : ["flast", "first", "first.last", "f.last", "firstlast"]),
    ];
    const orderedUnique = [...new Set(ordered)];
    const domain = lead.domain;
    let chosen = null;
    let tried = 0;
    const isCatchallDomain = catchallDomains.has(domain);

    for (const p of orderedUnique) {
      if (tried >= MAX_PROBES && !isCatchallDomain) break;
      const local = buildLocal(p, np);
      if (!local) continue;
      const email = `${local}@${domain}`;
      if (usedEmails.has(email)) {
        chosen = { email, source: "verified-pattern", confidence: "high", url: lead.website };
        break;
      }
      const ver = await verify(email);
      tried++;
      if (!ver) continue;
      if (ver.catchall) {
        // The domain accepts any local part, so a probe proves nothing. Do not
        // invent an address here — the generic fallback below gets first pick.
        catchallDomains.add(domain);
        break;
      }
      if (ver.reachable === "safe" || (ver.reachable === "risky" && ver.deliverable && !ver.catchall)) {
        chosen = { email, source: "verified-pattern", confidence: "high", url: lead.website };
        break;
      }
      // invalid -> try the next pattern
      if (ver.reachable === "invalid") continue;
      await new Promise((r) => setTimeout(r, gap));
    }

    results.push({ lead, email: chosen ? chosen.email : "", source: chosen ? chosen.source : "none", confidence: chosen ? chosen.confidence : "none", url: chosen ? chosen.url : "", tried });
  }
}

function buildLocal(pattern, np) {
  const { first, last, lastJoin } = np;
  const f = first[0] || "";
  const l = last;
  switch (pattern) {
    case "flast": return `${f}${l}`;
    case "flastjoin": return `${f}${lastJoin}`;
    case "first": return first;
    case "first.last": return `${first}.${l}`;
    case "first.lastjoin": return `${first}.${lastJoin}`;
    case "f.last": return `${f}.${l}`;
    case "firstlast": return `${first}${l}`;
    case "firstlastjoin": return `${first}${lastJoin}`;
    case "last.first": return `${l}.${first}`;
    case "first_last": return `${first}_${l}`;
    case "last": return l;
    case "f_last": return `${f}_${l}`;
    default: return null;
  }
}

if (DO_VERIFY) {
  console.log(`[match] verifying up to ${pending.length} guessed addresses, ${CONCURRENCY} streams ...`);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => verifyWorker()));
  saveCache();
  console.log(`[match] verification done in ${((Date.now() - t0) / 60000).toFixed(1)} min, probes=${probes}`);
} else {
  for (const p of pending) {
    const np = nameParts(p.lead);
    const local = buildLocal("flast", np);
    results.push({ lead: p.lead, email: local ? `${local}@${p.lead.domain}` : "", source: "guess-unverified", confidence: "low", url: p.lead.website });
  }
}

// ------------------------------------------------------------------ generic fallback
// IR inboxes first (ir@ > investors@ > info@/contact@): they are monitored and
// the message still reaches the company when no personal address can be found.
function genericRank(email) {
  const local = String(email).split("@")[0].toLowerCase();
  if (/^(ir|investor|investors|investorrelations)$/.test(local)) return 0;
  if (/^(corporate|company|contact|enquiries|enquiry|hello|admin|office|reception)$/.test(local)) return 1;
  if (/^(info|mail|general|accounts|support|sales|media|team)$/.test(local)) return 2;
  return 3;
}

const genericAssigned = new Set();
for (const r of results) {
  if (r.email) continue;
  const crawled = emailsFor(r.lead.domain)
    .filter((e) => GENERIC_LOCAL.test(e.email.split("@")[0]))
    .map((e) => ({ email: e.email.toLowerCase(), from: "crawled", url: e.source }));
  const csvGeneric = r.lead.generic_email && r.lead.generic_email.includes("@")
    ? [{ email: r.lead.generic_email.toLowerCase(), from: "csv", url: r.lead.website }]
    : [];
  const pool = [...crawled, ...csvGeneric].filter((c) => !genericAssigned.has(c.email) && !usedEmails.has(c.email));
  pool.sort((a, b) => genericRank(a.email) - genericRank(b.email));
  const pick = pool[0];
  if (pick) {
    genericAssigned.add(pick.email);
    usedEmails.add(pick.email);
    r.email = pick.email;
    r.source = pick.from === "csv" ? "generic-csv" : "generic";
    r.confidence = "medium";
    r.url = r.url || pick.url || r.lead.website;
  } else if (catchallDomains.has(r.lead.domain)) {
    // Catch-all domain and no monitored inbox: nothing here can be verified, so
    // the address stays empty rather than inventing one.
    r.source = "catchall-skip";
  }
}

// ------------------------------------------------------------------ output
for (const k of Object.keys(stats)) stats[k] = 0;
for (const r of results) {
  const map = {
    published: "published",
    crawled: "crawled",
    "crawled-fuzzy": "crawledFuzzy",
    "verified-pattern": "verified",
    "catchall-pattern": "catchall",
    generic: "generic",
    "generic-csv": "generic",
    "catchall-skip": "catchall",
  };
  const key = map[r.source] || "none";
  stats[key]++;
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "First Name", "Last Name", "Title", "Company", "Ticker", "Exchange", "Country", "City",
  "Company Website", "Email", "Email Source", "Source URL", "Pattern Email (unverified)",
  "Generic Email", "Phone", "LinkedIn", "Segment", "Notes",
  "Email Confidence", "Email Found By",
];
const rows = results
  .sort((a, b) => a.lead.idx - b.lead.idx)
  .map(({ lead, email, source, confidence, url }) => [
    lead.first, lead.last, lead.title, lead.company, lead.ticker, lead.exchange, lead.country, lead.city,
    lead.website, email, source === "published" ? "published" : url ? "crawled-or-verified" : "", url,
    "", lead.generic_email, lead.phone, lead.linkedin, lead.segment, lead.notes,
    confidence, source,
  ]);

const csv = [HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
fs.writeFileSync(path.join(HERE, "enriched.csv"), csv, "utf8");
fs.writeFileSync(
  path.join(HERE, "enrich_report.json"),
  JSON.stringify({ stats, total: results.length, probes, verified_at: new Date().toISOString() }, null, 2),
  "utf8",
);

const mailables = results.filter((r) => r.email && r.source !== "guess-unverified");
fs.writeFileSync(
  path.join(HERE, "enriched.json"),
  JSON.stringify(
    results.map((r) => ({
      idx: r.lead.idx,
      first: r.lead.first,
      last: r.lead.last,
      title: r.lead.title,
      company: r.lead.company,
      ticker: r.lead.ticker,
      exchange: r.lead.exchange,
      country: r.lead.country,
      city: r.lead.city,
      website: r.lead.website,
      domain: r.lead.domain,
      segment: r.lead.segment,
      email: r.email,
      source: r.source,
      confidence: r.confidence,
      source_url: r.url,
      phone: r.lead.phone,
      linkedin: r.lead.linkedin,
    })),
    null,
    1,
  ),
  "utf8",
);
console.log("[match] results:", stats);
console.log(`[match] dropped placeholder names: ${skippedNames.length}`);
console.log(`[match] leads with a usable email: ${mailables.length}/${results.length}`);
console.log("[match] wrote enriched.csv + enriched.json + enrich_report.json");
