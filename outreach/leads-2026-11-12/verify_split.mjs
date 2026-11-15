#!/usr/bin/env node
// Sanity-check the split: company subscribers carry the attribs the team template
// needs, and the person/company campaigns are the copy we expect.
import { lm } from "./lm_api.mjs";

const EMAIL = process.argv[2] || "ir@goldrunnerexploration.com";
const q = encodeURIComponent(`subscriber.email = '${EMAIL}'`);
const r = await lm("GET", `/api/subscribers?query=${q}&per_page=5`);
const s = (r.json?.data?.results || []).find((x) => x.email.toLowerCase() === EMAIL.toLowerCase());
console.log("subscriber:", s ? `${s.email} (${s.name})` : "NOT FOUND");
if (s) {
  console.log("  lists:", s.lists.map((l) => l.name).join(", "));
  console.log("  attribs.company_name:", s.attribs?.company_name);
  console.log("  attribs.batch:", s.attribs?.batch, "| email_confidence:", s.attribs?.email_confidence);
}

for (const id of [10, 11, 12, 13]) {
  const c = await lm("GET", `/api/campaigns/${id}`);
  const d = c.json?.data;
  if (!d) continue;
  const firstPara = String(d.body || "").split("\n")[0];
  console.log(`${id} ${d.name.padEnd(38)} ${d.status.padEnd(9)} sent ${d.sent}/${d.to_send} | subj=${JSON.stringify(d.subject)} | ${firstPara}`);
}
