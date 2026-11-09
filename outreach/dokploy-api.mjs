#!/usr/bin/env node
// Minimal Dokploy API client (tRPC over HTTP) for the OreWire panel.
//
// Dokploy's REST endpoints are gone; everything goes through tRPC:
//   GET  /api/trpc/<router>.<proc>?batch=1&input=<urlencoded {"0":{"json":<input>}}>
//   POST /api/trpc/<router>.<proc>   body: {"json": <input>}
//
// Auth: POST /api/auth/sign-in/email -> signed `better-auth.session_token` cookie
// (Dokploy rejects requests without an Origin header). The cookie is cached in
// .dokploy-session.json so we only log in when needed.
//
// Transport note: this laptop's LAN resolver intermittently returns EAI_AGAIN
// for *.orewire.com, so resolution falls back to 1.1.1.1 / 8.8.8.8 per request.
//
// Usage:
//   node dokploy-api.mjs GET  domain.byComposeId '{"composeId":"..."}'
//   node dokploy-api.mjs POST domain.create '{"host":"..."}'
//   node dokploy-api.mjs GET  compose.one '{"composeId":"..."}' --raw

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import dns from "node:dns";
import { fileURLToPath } from "node:url";

const BASE = process.env.DOKPLOY_URL || "https://dokploy.orewire.com";
const HOST = new URL(BASE).hostname;
const EMAIL = process.env.DOKPLOY_EMAIL || "azeemamjad225@gmail.com";
const PASSWORD = process.env.DOKPLOY_PASSWORD || "Azeem@1234";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(HERE, ".dokploy-session.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- transport
const publicResolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);
let cachedIp = null;

async function resolveHost(hostname) {
  if (cachedIp) return cachedIp;
  const errors = [];
  try {
    const a = await dns.promises.lookup(hostname, { family: 4 });
    cachedIp = a.address;
    return cachedIp;
  } catch (e) {
    errors.push(e.message);
  }
  try {
    const addrs = await publicResolver.resolve4(hostname);
    if (addrs && addrs.length) {
      cachedIp = addrs[0];
      return cachedIp;
    }
    errors.push("no A records from public resolver");
  } catch (e) {
    errors.push(e.message);
  }
  throw new Error(`cannot resolve ${hostname} (${errors.join("; ")})`);
}

function request(method, pathAndQuery, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        port: 443,
        path: pathAndQuery,
        method,
        headers,
        servername: HOST,
        // Node 20+ enables happy-eyeballs by default, which calls lookup with
        // { all: true } and expects an array of addresses back — handing it a
        // bare IP string throws ERR_INVALID_IP_ADDRESS.
        autoSelectFamily: false,
        lookup: (hostname, options, cb) => {
          resolveHost(hostname)
            .then((ip) => {
              if (options && options.all) cb(null, [{ address: ip, family: 4 }]);
              else cb(null, ip, 4);
            })
            .catch((e) => cb(e));
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------- auth
function loadCookie() {
  try {
    const j = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    if (j.cookie && Date.now() - j.at < 1000 * 60 * 60 * 12) return j.cookie;
  } catch {}
  return null;
}

function saveCookie(cookie) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie, at: Date.now() }), "utf8");
}

export async function login({ force = false, log = () => {} } = {}) {
  if (!force) {
    const cached = loadCookie();
    if (cached) return cached;
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await request(
      "POST",
      "/api/auth/sign-in/email",
      {
        "content-type": "application/json",
        // Dokploy's auth rejects requests with a missing/null Origin header.
        origin: BASE,
        referer: `${BASE}/`,
      },
      JSON.stringify({ email: EMAIL, password: PASSWORD }),
    );
    if (res.status === 429) {
      log(`login rate-limited (429), sleeping ${10 * attempt}s`);
      await sleep(10000 * attempt);
      continue;
    }
    if (res.status !== 200) throw new Error(`login failed: HTTP ${res.status} ${res.text}`);
    const setCookie = res.headers["set-cookie"] || [];
    const raw = setCookie.find((c) => c.startsWith("better-auth.session_token="));
    if (!raw) throw new Error("login: no better-auth cookie in response");
    const cookie = raw.split(";")[0];
    saveCookie(cookie);
    return cookie;
  }
  throw new Error("login: rate limited after retries");
}

// ---------------------------------------------------------------- tRPC
async function call(method, proc, input, { cookie, raw = false } = {}) {
  let pathAndQuery, body;
  if (method === "GET") {
    const payload = JSON.stringify({ 0: { json: input ?? null } });
    pathAndQuery = `/api/trpc/${proc}?batch=1&input=${encodeURIComponent(payload)}`;
  } else {
    pathAndQuery = `/api/trpc/${proc}`;
    body = JSON.stringify({ json: input ?? {} });
  }
  const res = await request(
    method,
    pathAndQuery,
    { cookie, "content-type": "application/json", origin: BASE, referer: `${BASE}/` },
    body,
  );
  if (raw) return res;
  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    parsed = res.text;
  }
  if (res.status < 200 || res.status >= 300) {
    const err = Array.isArray(parsed) ? parsed[0]?.error?.json : parsed?.error?.json;
    const msg = err?.message || res.text;
    const zod = err?.data?.zodError ? JSON.stringify(err.data.zodError) : "";
    throw new Error(`${method} ${proc} -> HTTP ${res.status}: ${msg} ${zod}`.trim());
  }
  return Array.isArray(parsed) ? parsed[0]?.result?.data?.json ?? parsed[0]?.result?.data ?? parsed : parsed;
}

export async function trpc(method, proc, input, opts = {}) {
  let cookie = opts.cookie || (await login(opts));
  try {
    return await call(method, proc, input, { ...opts, cookie });
  } catch (e) {
    if (/HTTP 401/.test(String(e.message))) {
      cookie = await login({ ...opts, force: true });
      return await call(method, proc, input, { ...opts, cookie });
    }
    throw e;
  }
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [method, proc, jsonArg] = process.argv.slice(2);
  if (!method || !proc) {
    console.error("usage: node dokploy-api.mjs <GET|POST> <router.proc> '<json-input>' [--raw]");
    process.exit(2);
  }
  const raw = process.argv.includes("--raw");
  const input = jsonArg ? JSON.parse(jsonArg) : null;
  try {
    const out = await call(method.toUpperCase(), proc, input, {
      cookie: await login({ log: console.error }),
      raw,
    });
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(1);
  }
}
