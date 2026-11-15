#!/usr/bin/env node
// Inspect a few subscribers from the new Person/Company lists.
import { lm } from "./lm_api.mjs";

const lists = (await lm("GET", "/api/lists?per_page=200")).json?.data?.results || [];
for (const name of ["AU Company 11-12", "CA Company 11-12", "AU Person 11-12", "CA Person 11-12"]) {
  const l = lists.find((x) => x.name === name);
  if (!l) {
    console.log(`${name}: missing`);
    continue;
  }
  const r = await lm("GET", `/api/subscribers?list_id=${l.id}&per_page=2`);
  const subs = r.json?.data?.results || [];
  console.log(`== ${name} (id ${l.id}, ${l.subscriber_count} subs)`);
  for (const s of subs) {
    console.log(`   ${s.email} | name=${s.name} | company_name=${JSON.stringify(s.attribs?.company_name)} | batch=${s.attribs?.batch} | conf=${s.attribs?.email_confidence}`);
    console.log(`      lists: ${s.lists.map((x) => x.name).join(" + ")}`);
  }
}
