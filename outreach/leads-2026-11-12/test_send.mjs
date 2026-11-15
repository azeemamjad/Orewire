#!/usr/bin/env node
// Stage 5a: prove the send chain end to end with a 1-recipient test campaign
// before the real batch goes out.
//
//   Listmonk -> console:2526 (SMTP proxy, rotates mailbox, 5/day cap) -> Postal
//
// Creates the "Test 11-12" list with our own probe inbox, a one-recipient
// campaign using the IR step-1 copy, starts it, then watches the console queue
// and the console's Sent & opens feed for delivery.
//
//   node test_send.mjs [--to probe-open@getorewire.com]

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lm } from "./lm_api.mjs";
import { jsonRequest } from "./lib_https.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const i = argv.indexOf("--to");
const TO = i >= 0 && argv[i + 1] ? argv[i + 1] : "probe-open@getorewire.com";
const LIST_NAME = "Test 11-12";
const CAMPAIGN_NAME = "TEST chain 11-12";
const CONSOLE = "https://emails-web.orewire.com";
const CONSOLE_COOKIE =
  "console_auth=" +
  crypto.createHmac("sha256", process.env.CONSOLE_PASSWORD || "XMoNeTB8hnCcWCfdNhw7")
    .update("orewire-console-session-v1")
    .digest("hex");

const BODY = `<p>Hi {{ .Subscriber.FirstName }},</p>
<p>This is the chain test for the 2026-11-12 batch — if you can read this, Listmonk reached the console proxy and Postal delivered it.</p>
<p>-- Azeem Amjad<br>OreWire</p>`;

async function consoleState() {
  const r = await jsonRequest(`${CONSOLE}/api/state`, { headers: { cookie: CONSOLE_COOKIE }, timeoutMs: 45000 });
  return r.json;
}
async function consoleSent() {
  const r = await jsonRequest(`${CONSOLE}/api/sent-messages`, { headers: { cookie: CONSOLE_COOKIE }, timeoutMs: 45000 });
  return (r.json && r.json.rows) || [];
}

// ---- list + subscriber -----------------------------------------------------
let lists = ((await lm("GET", "/api/lists?per_page=200")).json?.data?.results) || [];
let list = lists.find((l) => l.name === LIST_NAME);
if (!list) {
  const r = await lm("POST", "/api/lists", { name: LIST_NAME, type: "private", optin: "single" });
  list = r.json?.data;
  console.log(`[test] created list "${LIST_NAME}" id=${list?.id}`);
} else {
  console.log(`[test] list "${LIST_NAME}" exists id=${list.id}`);
}
if (!list) throw new Error("could not create test list");

const sub = await lm("POST", "/api/subscribers", {
  email: TO,
  name: "Chain Test",
  status: "enabled",
  preconfirm_subscriptions: true,
  lists: [list.id],
  attribs: { company_name: "OreWire", batch: "test-11-12" },
});
console.log(`[test] subscriber ${TO}: HTTP ${sub.status}`);

// ---- campaign --------------------------------------------------------------
lists = ((await lm("GET", "/api/lists?per_page=200")).json?.data?.results) || [];
const fresh = lists.find((l) => l.name === LIST_NAME);
console.log(`[test] list membership now ${fresh?.subscriber_count}`);

const existing = ((await lm("GET", "/api/campaigns?per_page=200")).json?.data?.results) || [];
let campaign = existing.find((c) => c.name === CAMPAIGN_NAME);
if (!campaign) {
  const r = await lm("POST", "/api/campaigns", {
    name: CAMPAIGN_NAME,
    subject: "OreWire chain test (ignore)",
    lists: [list.id],
    from_email: "Azeem Amjad <hello@getorewire.com>",
    type: "regular",
    content_type: "html",
    body: BODY,
    template_id: 1,
    messenger: "email",
    headers: [],
    tags: ["batch-11-12", "test"],
    send_at: null,
  });
  campaign = r.json?.data;
  console.log(`[test] created campaign id=${campaign?.id} status=${campaign?.status}`);
} else {
  console.log(`[test] campaign exists id=${campaign.id} status=${campaign.status}`);
}

const beforeQueue = (await consoleState()).queue.length;
const beforeSent = (await consoleSent()).length;
console.log(`[test] console before: queue=${beforeQueue} sent_rows=${beforeSent}`);

if (campaign.status !== "running" && campaign.status !== "finished") {
  const r = await lm("PUT", `/api/campaigns/${campaign.id}/status`, { status: "running" });
  console.log(`[test] start -> HTTP ${r.status} ${(r.text || "").slice(0, 100)}`);
}

// ---- watch -----------------------------------------------------------------
let delivered = null;
for (let n = 0; n < 40; n++) {
  await new Promise((res) => setTimeout(res, 6000));
  const st = await consoleState();
  const rows = await consoleSent();
  const hit = rows.find((r) => String(r.to).toLowerCase() === TO.toLowerCase() && /chain test/i.test(r.subject || ""));
  if (n % 3 === 0) console.log(`[test] t+${(n + 1) * 6}s console queue=${st.queue.length} sent_today=${st.sent_today} rows=${rows.length}`);
  if (hit) {
    delivered = hit;
    break;
  }
}
if (delivered) {
  console.log(`[test] DELIVERED: to=${delivered.to} from=${delivered.mailbox} status=${delivered.status} opened=${delivered.opened}`);
} else {
  console.log("[test] not seen in the console feed yet — check Listmonk campaign status and console log");
}
const cam = (await lm("GET", `/api/campaigns/${campaign.id}`)).json?.data;
console.log(`[test] campaign status=${cam?.status} sent=${cam?.sent}/${cam?.to_send}`);
// leave the campaign finished; the test list is reused on the next run
