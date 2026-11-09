#!/usr/bin/env node
// Minimal Dokploy API client (tRPC over HTTP) for the OreWire panel.
//
// Dokploy's REST endpoints are gone; everything goes through tRPC:
//   GET  /api/trpc/<router>.<proc>?batch=1&input=<urlencoded {"0":{"json":<input>}}>
//   POST /api/trpc/<router>.<proc>   body: {"json": <input>}
//
// Auth: POST /api/auth/sign-in/email -> signed `better-auth.session_token` cookie.
// That cookie is cached in .dokploy-session.json so we only log in when needed.
//
// Usage:
//   node dokploy-api.mjs GET  domain.byComposeId '{"composeId":"..."}'
//   node dokploy-api.mjs POST domain.create '{"host":"..."}'
//   node dokploy-api.mjs GET  compose.one '{"composeId":"..."}' --raw

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.DOKPLOY_URL || "https://dokploy.orewire.com";
const EMAIL = process.env.DOKPLOY_EMAIL || "azeemamjad225@gmail.com";
const PASSWORD = process.env.DOKPLOY_PASSWORD || "Azeem@1234";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(HERE, ".dokploy-session.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Dokploy's auth rejects requests with a missing/null Origin header.
        origin: BASE,
        referer: `${BASE}/`,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.status === 429) {
      log(`login rate-limited (429), sleeping ${10 * attempt}s`);
      await sleep(10000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const raw = setCookie.find((c) => c.startsWith("better-auth.session_token="));
    if (!raw) throw new Error("login: no better-auth cookie in response");
    const cookie = raw.split(";")[0];
    saveCookie(cookie);
    return cookie;
  }
  throw new Error("login: rate limited after retries");
}

async function call(method, proc, input, { cookie, raw = false } = {}) {
  let url, init;
  if (method === "GET") {
    const payload = JSON.stringify({ 0: { json: input ?? null } });
    url = `${BASE}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(payload)}`;
    init = { method: "GET", headers: { cookie } };
  } else {
    url = `${BASE}/api/trpc/${proc}`;
    init = {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ json: input ?? {} }),
    };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (raw) return { status: res.status, text };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = Array.isArray(body) ? body[0]?.error?.json : body?.error?.json;
    const msg = err?.message || text;
    const zod = err?.data?.zodError ? JSON.stringify(err.data.zodError) : "";
    throw new Error(`${method} ${proc} -> HTTP ${res.status}: ${msg} ${zod}`.trim());
  }
  return Array.isArray(body) ? body[0]?.result?.data?.json ?? body[0]?.result?.data ?? body : body;
}

export async function trpc(method, proc, input, opts = {}) {
  let cookie = opts.cookie || (await login(opts));
  try {
    return await call(method, proc, input, { ...opts, cookie });
  } catch (e) {
    // Session may have been rotated server-side; re-login once.
    if (/HTTP 401/.test(String(e.message))) {
      cookie = await login({ ...opts, force: true });
      return await call(method, proc, input, { ...opts, cookie });
    }
    throw e;
  }
}

// ---- CLI ----
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
