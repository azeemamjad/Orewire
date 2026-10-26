// OreWire outreach bridge - Stage 2: verify mailboxes via Reacher (check-if-email-exists)
// Usage: node verify-leads.mjs <emails.txt> <results.csv>
// - appends each result immediately (crash-safe, visible progress)
// - resumes: skips emails already present in results.csv
import fs from "node:fs";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("usage: node verify-leads.mjs <emails.txt> <results.csv>");
  process.exit(1);
}

const CONC = 6;
const TIMEOUT_MS = 150000;

// load already-checked emails for resume
const done = new Set();
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, "utf8").split(/\r?\n/).slice(1)) {
    const e = line.split(",")[0];
    if (e) done.add(e.trim());
  }
}

const all = fs.readFileSync(inFile, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const emails = all.filter(e => !done.has(e));
console.error(`total=${all.length} already-done=${done.size} to-check=${emails.length}`);
if (!fs.existsSync(outFile)) fs.writeFileSync(outFile, "email,is_reachable,is_deliverable,is_catch_all,is_disposable\n");

let i = 0;

async function check(email) {
  try {
    const r = await fetch("http://localhost:8080/v0/check_email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json();
    return {
      email,
      is_reachable: j.is_reachable || "",
      is_deliverable: j.smtp ? String(j.smtp.is_deliverable) : "",
      is_catch_all: j.smtp ? String(j.smtp.is_catch_all) : "",
      is_disposable: j.misc ? String(j.misc.is_disposable) : "",
    };
  } catch {
    return { email, is_reachable: "error", is_deliverable: "", is_catch_all: "", is_disposable: "" };
  }
}

async function worker() {
  while (i < emails.length) {
    const email = emails[i++];
    const res = await check(email);
    fs.appendFileSync(outFile, [res.email, res.is_reachable, res.is_deliverable, res.is_catch_all, res.is_disposable].join(",") + "\n");
    console.error(`[${done.size + i}/${all.length}] ${res.email} -> ${res.is_reachable}`);
  }
}

await Promise.all(Array.from({ length: CONC }, worker));
console.error("all done");
