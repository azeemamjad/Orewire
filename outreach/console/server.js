/* Outreach Console — SMTP rotation proxy
 * Listmonk -> this proxy (port 2526) -> rotated mailboxes -> Postal (2525)
 * Features: per-mailbox daily caps, warmup curves, paced queue, reply-watch (IMAP), web UI.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { SMTPServer } = require("smtp-server");
const nodemailer = require("nodemailer");

const PORT = process.env.CONSOLE_PORT || 8018;
const STATE_FILE = path.join(process.env.STATE_DIR || __dirname, "state.json");
const UPSTREAM = { host: process.env.POSTAL_SMTP_HOST || "localhost", port: Number(process.env.POSTAL_SMTP_PORT || 2525), secure: false }; // Postal SMTP

// ---------- state ----------
function today() { return new Date().toISOString().slice(0, 10); }

function defaultMailboxes() {
  const boxes = [];
  for (let i = 1; i <= 9; i++) {
    boxes.push({
      id: "mb" + i,
      email: `box${i}@getorewire.co`,        // rename in UI when real domains connect
      display_name: "OreWire",
      host: UPSTREAM.host, port: UPSTREAM.port,
      user: "2r3Fgs3I5XZupWRIm76JxIyl",      // local Postal credential (server-wide for now)
      pass: "2r3Fgs3I5XZupWRIm76JxIyl",
      daily_cap: 5,
      enabled: true,
      warmup: { active: false, start: today(), start_per_day: 2, increment: 2, max_per_day: 30 },
      sent_today: 0, sent_date: today(), total_sent: 0,
    });
  }
  return boxes;
}

let state = {
  mailboxes: defaultMailboxes(),
  settings: { pace_seconds: 300, reply_check_minutes: 0, imap: { host: "", port: 993, secure: true, user: "", pass: "", mailbox: "INBOX" }, links: { lists: "", postal: "" } },
  queue: [],        // {id, mailbox_id, mail_from, rcpt_to, raw, attempts, queued_at}
  replied: [],      // {from, subject, seen_at}
  log: [],
};
if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); }
function log(msg) {
  const line = { at: new Date().toISOString(), msg };
  state.log.unshift(line); state.log = state.log.slice(0, 200);
  console.log("[console]", msg); save();
}
if (!fs.existsSync(STATE_FILE)) { save(); log("state initialised with 9 mailboxes"); }

// ---------- caps & warmup ----------
function capFor(mb) {
  if (mb.sent_date !== today()) { mb.sent_today = 0; mb.sent_date = today(); }
  if (!mb.enabled) return 0;
  if (mb.warmup && mb.warmup.active) {
    const days = Math.floor((Date.now() - new Date(mb.warmup.start + "T00:00:00Z")) / 86400000);
    return Math.min(mb.warmup.start_per_day + days * mb.warmup.increment, mb.warmup.max_per_day);
  }
  return mb.daily_cap;
}
function pickMailbox() {
  const avail = state.mailboxes.filter(mb => capFor(mb) > mb.sent_today);
  if (!avail.length) return null;
  return avail[Math.floor(Math.random() * avail.length)]; // random rotation
}

// ---------- outbound (to Postal via nodemailer) ----------
const transports = new Map();
function transportFor(mb) {
  if (!transports.has(mb.id)) {
    transports.set(mb.id, nodemailer.createTransport({
      host: mb.host, port: mb.port, secure: false,
      tls: { rejectUnauthorized: false },
      auth: { user: mb.user, pass: mb.pass },
      pool: true, maxConnections: 1,
    }));
  }
  return transports.get(mb.id);
}

async function releaseOne(item) {
  const mb = state.mailboxes.find(m => m.id === item.mailbox_id);
  if (!mb) { item.attempts = 99; return "mailbox-gone"; }
  if (capFor(mb) <= mb.sent_today) return "cap-reached"; // re-queue for tomorrow's window
  try {
    await transportFor(mb).sendMail({ from: `${mb.display_name} <${mb.email}>`, to: item.rcpt_to.join(", "), raw: item.raw });
    mb.sent_today += 1; mb.total_sent += 1;
    log(`sent -> ${item.rcpt_to} via ${mb.email} (${mb.sent_today}/${capFor(mb)} today)`);
    return "sent";
  } catch (e) {
    item.attempts = (item.attempts || 0) + 1;
    log(`send FAILED via ${mb.email}: ${String(e.message).slice(0, 120)} (attempt ${item.attempts})`);
    return item.attempts >= 3 ? "dead" : "retry";
  }
}

let lastRelease = 0;
let lastStatsSync = 0;

// ---------- stats sync from Postal message DB (source of truth) ----------
// Counts today's outgoing messages per mail_from across all postal-server-* DBs,
// including sends made directly through the Postal API (bypassing this proxy).
async function syncSentCounts() {
  if (Date.now() - lastStatsSync < 60000) return;
  lastStatsSync = Date.now();
  let mysql;
  try { mysql = require("mysql2/promise"); } catch (e) { return log("[stats] mysql2 not loadable: " + e.message); }
  const host = process.env.POSTAL_MESSAGE_DB_HOST || "postal-mariadb";
  let conn;
  try {
    conn = await mysql.createConnection({
      host, port: 3306,
      user: process.env.POSTAL_DB_USER || "root",
      password: process.env.POSTAL_DB_PASSWORD || "",
      connectTimeout: 8000,
    });
  } catch (e) { return log("[stats] DB connect failed: " + String(e.message).slice(0, 100)); }
  try {
    const [dbs] = await conn.query("SHOW DATABASES");
    const prefix = process.env.POSTAL_DB_PREFIX || "postal-server-";
    const list = dbs.map(d => d.Database).filter(n => n && String(n).startsWith(prefix));
    if (!list.length) return log(`[stats] no ${prefix}* DBs found (total dbs=${dbs.length})`);
    const parts = list.map(n => `SELECT mail_from, COUNT(*) c FROM \`${n}\`.messages WHERE scope = 'outgoing' AND mail_from IS NOT NULL AND timestamp >= UNIX_TIMESTAMP(CURDATE()) GROUP BY mail_from`);
    const [rows] = await conn.query(parts.join(" UNION ALL "));
    const counts = {};
    let total = 0;
    for (const row of rows) {
      const k = String(row.mail_from).toLowerCase();
      counts[k] = (counts[k] || 0) + Number(row.c);
      total += Number(row.c);
    }
    let changed = false; let matched = 0;
    for (const mb of state.mailboxes) {
      const c = counts[mb.email.toLowerCase()] || 0;
      if (mb.sent_date !== today()) { mb.sent_today = 0; mb.sent_date = today(); }
      if (c > 0) matched++;
      if (c !== mb.sent_today) { mb.sent_today = c; changed = true; }
    }
    log(`[stats] synced: dbs=${list.length} rows=${rows.length} total=${total} mailboxes-with-sends=${matched} changed=${changed}`);
    if (changed) save();
  } finally {
    await conn.end();
  }
}

async function tick() {
  // daily reset happens inside capFor
  await syncSentCounts().catch(e => log("stats sync error: " + e.message));
  if (!state.queue.length) return;
  const now = Date.now();
  if (now - lastRelease < state.settings.pace_seconds * 1000) return;
  lastRelease = now;
  const item = state.queue.shift();
  const res = await releaseOne(item);
  if (res === "retry" || res === "cap-reached") state.queue.push(item);
  save();
}

// ---------- inbound SMTP proxy (listmonk connects here) ----------
function rewriteFrom(raw, mb) {
  const fromLine = `From: ${mb.display_name} <${mb.email}>`;
  if (/^from:\s/im.test(raw)) return raw.replace(/^from:.*$/im, fromLine);
  return fromLine + "\r\n" + raw;
}

const proxy = new SMTPServer({
  authOptional: true,
  banner: "Outreach Console proxy",
  onConnect(session, cb) { log(`SMTP CONNECT from ${session.remoteAddress}`); cb(); },
  onAuth(auth, session, cb) { cb(null, { user: auth.username || "anonymous" }); }, // accept listmonk's auth, we auth upstream ourselves
  onData(stream, session, cb) {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const mb = pickMailbox();
      if (!mb) {
        log("INBOUND REJECTED: all mailboxes at daily cap (listmonk will retry)");
        return cb(new Error("451 4.4.1 all mailboxes at daily cap - try later"));
      }
      const item = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        mailbox_id: mb.id,
        mail_from: mb.email,
        rcpt_to: session.envelope.rcptTo.map(r => r.address),
        raw: rewriteFrom(raw, mb),
        attempts: 0,
        queued_at: new Date().toISOString(),
      };
      state.queue.push(item); save();
      log(`queued for ${item.rcpt_to} via ${mb.email} (queue=${state.queue.length})`);
      cb();
    });
  },
});
proxy.on("error", (e) => log("proxy error: " + e.message));
proxy.listen(2526, () => log("SMTP proxy listening on 2526"));

// ---------- reply watch (IMAP) ----------
async function checkReplies() {
  const imap = state.settings.imap;
  if (!imap.host || !imap.user) return log("reply-check skipped: IMAP not configured");
  let ImapFlow;
  try { ImapFlow = require("imapflow").ImapFlow; } catch { return log("reply-check skipped: imapflow not installed"); }
  const client = new ImapFlow({ host: imap.host, port: imap.port || 993, secure: imap.secure !== false, auth: { user: imap.user, pass: imap.pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(imap.mailbox || "INBOX");
    try {
      const since = new Date(Date.now() - 7 * 86400000);
      const uids = await client.search({ since });
      for (const uid of (uids || []).slice(-50)) {
        const msg = await client.fetchOne(uid, { envelope: true, uid: true });
        const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0]) ? `${msg.envelope.from[0].mailbox}@${msg.envelope.from[0].host}` : "";
        if (from && !state.replied.some(r => r.from === from)) {
          state.replied.unshift({ from, subject: (msg.envelope && msg.envelope.subject) || "", seen_at: new Date().toISOString() });
          log(`REPLY detected from ${from} — stop-on-reply`);
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    log(`reply-check failed: ${String(e.message).slice(0, 140)}`);
  }
  state.replied = state.replied.slice(0, 100);
  save();
}

// ---------- scheduler ----------
setInterval(() => { tick().catch(e => log("tick error: " + e.message)); }, 20000);
let lastReplyCheck = 0;
setInterval(() => {
  const mins = Number(state.settings.reply_check_minutes || 0);
  if (mins > 0 && Date.now() - lastReplyCheck > mins * 60000) { lastReplyCheck = Date.now(); checkReplies(); }
}, 60000);

// ---------- web UI + API ----------
const ui = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" }); return res.end(ui);
  }
  if (url.pathname === "/api/state") {
    const view = {
      today: today(),
      mailboxes: state.mailboxes.map(mb => ({ ...mb, cap_now: capFor(mb) })),
      settings: state.settings,
      queue: state.queue,
      replied: state.replied,
      log: state.log.slice(0, 60),
      sent_today: state.mailboxes.reduce((a, m) => a + (m.sent_date === today() ? m.sent_today : 0), 0),
    };
    res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(view));
  }
  if (url.pathname === "/api/dns-records") {
    const f = path.join(process.env.STATE_DIR || __dirname, "dns-records.txt");
    if (fs.existsSync(f)) { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(fs.readFileSync(f, "utf8")); }
    res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "no dns-records.txt yet — redeploy the email stack to generate it" }));
  }
  if (url.pathname === "/api/selftest") {
    (async () => {
      const out = { steps: [] };
      try {
        const t = nodemailer.createTransport({ host: "127.0.0.1", port: 2526, secure: false, tls: { rejectUnauthorized: false } });
        const info = await t.sendMail({ from: "selftest@orewire.com", to: "selftest@example.com", subject: "console selftest", text: "selftest" });
        out.steps.push({ step: "client->proxy", ok: true, resp: info.response });
      } catch (e) { out.steps.push({ step: "client->proxy", ok: false, error: String(e.message).slice(0, 200) }); }
      try {
        const mb = state.mailboxes.find(m => m.enabled) || state.mailboxes[0];
        const info = await transportFor(mb).sendMail({ from: "selftest@getorewire.com", to: "selftest@example.com", subject: "console selftest upstream", text: "selftest" });
        out.steps.push({ step: "proxy->postal", ok: true, resp: info.response });
      } catch (e) { out.steps.push({ step: "proxy->postal", ok: false, error: String(e.message).slice(0, 200) }); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    })();
    return;
  }
  if (url.pathname === "/api/queue-sample") {
    const first = state.queue[0];
    let sigContext = null;
    if (first) {
      const m = first.raw.search(/Azeem/i);
      if (m >= 0) sigContext = first.raw.slice(Math.max(0, m - 200), m + 300);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ len: state.queue.length, sample: first ? first.raw.slice(0, 400) : null, sigContext }));
  }
  if (req.method === "POST" && url.pathname === "/api/sanitize-queue") {
    // Tolerant matcher: allow quoted-printable soft breaks (=CRLF) between any two characters.
    function tolerant(str) {
      const esc = [...str].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return new RegExp(esc.join("(?:=\\r?\\n)?"), "gi");
    }
    const sigs = [
      tolerant("<p>-- Azeem Amjad<br>OreWire</p>"),
      tolerant("<p>-- Azeem Amjad<br />OreWire</p>"),
      tolerant("-- Azeem Amjad\r\nOreWire"),
      tolerant("-- Azeem Amjad\nOreWire"),
    ];
    const loneLines = /(^|\r?\n)[ \t]*(?:--\s*Azeem Amjad|OreWire)[ \t]*(\r?\n|$)/g;
    const emptyP = /<p>\s*<\/p>/gi;
    let n = 0;
    for (const item of state.queue) {
      if (!item.raw) continue;
      const before = item.raw;
      let raw = before;
      for (const re of sigs) raw = raw.replace(re, "");
      raw = raw.replace(loneLines, "$1").replace(emptyP, "");
      if (raw !== before) { item.raw = raw; n++; }
    }
    save();
    log(`sanitized ${n} queued messages (signature removed)`);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ sanitized: n, queue: state.queue.length }));
  }
  if (req.method === "POST" && url.pathname === "/api/mailbox") {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const b = JSON.parse(body);
      const mb = state.mailboxes.find(m => m.id === b.id);
      if (mb) {
        if (typeof b.enabled === "boolean") mb.enabled = b.enabled;
        if (b.email) mb.email = b.email;
        if (b.display_name !== undefined) mb.display_name = b.display_name;
        if (b.daily_cap !== undefined) mb.daily_cap = Math.max(0, Number(b.daily_cap));
        if (b.warmup) mb.warmup = { ...mb.warmup, ...b.warmup };
        if (b.user) mb.user = b.user;
        if (b.pass) mb.pass = b.pass;
        if (b.host) { mb.host = b.host; transports.delete(mb.id); }
        if (b.port !== undefined) { mb.port = Number(b.port); transports.delete(mb.id); }
        save(); log(`mailbox updated: ${mb.email}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
    }); return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const b = JSON.parse(body);
      if (b.pace_seconds !== undefined) state.settings.pace_seconds = Math.max(10, Number(b.pace_seconds));
      if (b.reply_check_minutes !== undefined) state.settings.reply_check_minutes = Number(b.reply_check_minutes);
      if (b.imap) state.settings.imap = { ...state.settings.imap, ...b.imap };
      if (b.links) state.settings.links = { ...state.settings.links, ...b.links };
      save(); log("settings updated");
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
    }); return;
  }
  if (req.method === "POST" && url.pathname === "/api/check-replies") {
    checkReplies().then(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ replied: state.replied })); });
    return;
  }
  res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => log(`Outreach Console UI on http://localhost:${PORT}`));
