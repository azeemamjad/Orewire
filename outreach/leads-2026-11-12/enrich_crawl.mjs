#!/usr/bin/env node
// Company-site email harvester for the OreWire issuer lead batches.
//
// Strategy: issuer (ASX/TSXV/CSE) IR contacts are almost always published on the
// company's own governance / board / contact pages, so we crawl those pages and
// extract mailto/plain-text addresses instead of guessing. Result per domain is
// appended to crawl_results.jsonl, so the run is resumable.
//
//   node enrich_crawl.mjs [--concurrency 8] [--limit 0] [--domains file]
//
// Output record:
//   { domain, ok, pages, emails: [{email, source}], generic: [...], error }

import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOMAINS_FILE = path.join(HERE, "domains.json");
const OUT_FILE = path.join(HERE, "crawl_results.jsonl");

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const CONCURRENCY = Number(arg("concurrency", 8));
const LIMIT = Number(arg("limit", 0));

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BAD_TLD = /\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?|ttf|pdf|mp4|zip)$/i;
const GENERIC_LOCAL = /^(info|contact|enquiries?|inquiries?|hello|admin|office|sales|support|ir|investors?|investor|investorrelations|corporate|company|general|mail|email|reception|accounts?|media|enquiry|info1|info2|ask|team)$/i;

// Pages most likely to list directors / IR contacts. Ordered by usefulness.
const PRIORITY = [
  /(^|\/)contact/i,
  /(^|\/)(board|directors|governance|management|leadership|team|people|our-team|board-of-directors)/i,
  /(^|\/)(investor|investors|ir|shareholder|corporate)/i,
  /(^|\/)(about|company|corporate-governance|who-we-are)/i,
];
const CANDIDATE_LINK = /(contact|board|director|governance|management|leadership|team|people|investor|shareholder|about|company|corporate|ir\b|profile|our-team|key-personnel|executive)/i;

function normUrl(u, base) {
  try {
    const url = new URL(u, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sameSite(host, domain) {
  return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
}

// This laptop's LAN resolver intermittently returns EAI_AGAIN and node's own
// dns.lookup is capped by the libuv threadpool (4), which starved a first run:
// 14 parallel fetches all waiting on DNS and nothing completing. So resolve
// through a dedicated resolver against 1.1.1.1/8.8.8.8, cache it, and skip a
// domain fast when it has no A record.
const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const dnsCache = new Map();
async function resolves(domain) {
  if (dnsCache.has(domain)) return dnsCache.get(domain);
  let ok = false;
  try {
    const a = await resolver.resolve4(domain);
    ok = Array.isArray(a) && a.length > 0;
  } catch {
    try {
      await dns.promises.lookup(domain, { family: 4 });
      ok = true;
    } catch {
      ok = false;
    }
  }
  dnsCache.set(domain, ok);
  return ok;
}

async function get(url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-AU,en;q=0.9",
      },
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !/text\/html|application\/xhtml|text\/plain|xml/i.test(ct)) {
      return { url: res.url || url, status: res.status, html: "", ct };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2_000_000) return { url: res.url || url, status: res.status, html: "", ct };
    return { url: res.url || url, status: res.status, html: Buffer.from(buf).toString("utf8"), ct };
  } catch (e) {
    return { url, status: 0, html: "", error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function cleanEmails(text, pageUrl) {
  const found = new Map();
  // de-obfuscate the common "[at]" / "(at)" / " at " variants used on IR pages
  const deob = text.replace(/\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+/gi, "@").replace(/\[\s*dot\s*\]|\(\s*dot\s*\)/gi, ".");
  for (const m of deob.matchAll(EMAIL_RE)) {
    let e = m[0].toLowerCase().replace(/^[.]+|[.]+$/g, "");
    if (BAD_TLD.test(e)) continue;
    if (e.length > 80) continue;
    if (/@(example|email|domain|sentry|wixpress|godaddy|cloudflare)\./.test(e)) continue;
    if (!found.has(e)) found.set(e, pageUrl);
  }
  return found;
}

async function crawlDomain(domain, { max = 10 } = {}) {
  if (!(await resolves(domain))) {
    return { domain, ok: false, pages: 0, emails: [], generic: [], error: "no A record" };
  }
  const base = `https://${domain}`;
  const seen = new Set();
  const emails = new Map();
  const pages = [];
  const queue = [];
  const errors = [];

  const home = await get(base);
  let startUrl = home.url || base;
  if (!home.html) {
    // try http:// and the www variant before giving up
    for (const alt of [`http://${domain}`, `https://www.${domain}`, `http://www.${domain}`]) {
      const r = await get(alt);
      if (r.html) {
        startUrl = r.url || alt;
        pages.push({ url: alt, status: r.status });
        for (const [e, src] of cleanEmails(r.html, alt)) emails.set(e, src);
        for (const href of extractLinks(r.html, alt, domain)) queue.push(href);
        break;
      }
      errors.push(`${alt}: ${r.status || r.error || "no html"}`);
    }
  } else {
    pages.push({ url: startUrl, status: home.status });
    for (const [e, src] of cleanEmails(home.html, startUrl)) emails.set(e, src);
    for (const href of extractLinks(home.html, startUrl, domain)) queue.push(href);
  }

  // Fetch priority pages first, then the rest up to the cap.
  queue.sort((a, b) => scoreLink(b) - scoreLink(a));
  for (const url of queue) {
    if (seen.size >= max) break;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await get(url);
    const finalUrl = r.url || url;
    pages.push({ url: finalUrl, status: r.status });
    if (!r.html) {
      if (r.error) errors.push(`${url}: ${r.error}`);
      continue;
    }
    for (const [e, src] of cleanEmails(r.html, finalUrl)) if (!emails.has(e)) emails.set(e, src);
    if (seen.size < 6) {
      // depth 2, but only for pages that look like people/contact pages
      for (const href of extractLinks(r.html, finalUrl, domain)) {
        if (seen.size >= max) break;
        if (!seen.has(href) && CANDIDATE_LINK.test(href)) queue.push(href);
      }
    }
  }

  const list = [...emails.entries()].map(([email, source]) => ({ email, source }));
  return {
    domain,
    ok: list.length > 0,
    pages: pages.length,
    emails: list,
    generic: list.filter((x) => GENERIC_LOCAL.test(x.email.split("@")[0])).map((x) => x.email),
    error: errors.slice(0, 3).join(" | ") || null,
  };
}

function scoreLink(url) {
  for (let i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].test(url)) return 100 - i * 10;
  return 0;
}

function extractLinks(html, pageUrl, domain) {
  const out = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const u = normUrl(m[1], pageUrl);
    if (!u) continue;
    let host;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    if (!sameSite(host.replace(/^www\./, ""), domain)) continue;
    if (/\.(png|jpe?g|gif|svg|css|js|ico|woff2?|mp4|zip|webp)$/i.test(u)) continue;
    out.add(u);
  }
  return [...out];
}

// ------------------------------------------------------------------ runner
const domains = JSON.parse(fs.readFileSync(DOMAINS_FILE, "utf8"));
const done = new Set();
if (fs.existsSync(OUT_FILE)) {
  for (const line of fs.readFileSync(OUT_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).domain);
    } catch {}
  }
}
const todo = domains.filter((d) => !done.has(d));
const work = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
console.log(`[crawl] domains=${domains.length} done=${done.size} todo=${todo.length} this-run=${work.length} concurrency=${CONCURRENCY}`);

const out = fs.createWriteStream(OUT_FILE, { flags: "a" });
let finished = 0;
let withEmails = 0;
const t0 = Date.now();

async function worker(items) {
  while (items.length) {
    const domain = items.shift();
    let rec;
    try {
      rec = await crawlDomain(domain);
    } catch (e) {
      rec = { domain, ok: false, pages: 0, emails: [], generic: [], error: String(e.message || e) };
    }
    const has = rec.emails.some((e) => !GENERIC_LOCAL.test(e.email.split("@")[0]));
    if (has) withEmails++;
    finished++;
    out.write(JSON.stringify(rec) + "\n");
    if (finished % 5 === 0 || finished === work.length) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`[crawl] ${finished}/${work.length} domains, personal-email domains=${withEmails}, ${mins}min`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(work)));
out.end();
console.log(`[crawl] DONE ${finished} domains, ${withEmails} with non-generic emails, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
