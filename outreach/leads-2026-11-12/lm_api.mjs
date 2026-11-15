#!/usr/bin/env node
// Listmonk REST client using the saved admin session cookie.
// (Listmonk's admin session is accepted on /api/*; no API user exists yet.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonRequest } from "./lib_https.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://lists.emails.orewire.com";

export function cookieHeader() {
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, "listmonk-cookies.json"), "utf8"));
  return raw.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function lm(method, apiPath, json = null, timeoutMs = 60000) {
  const r = await jsonRequest(`${BASE}${apiPath}`, {
    method,
    headers: { cookie: cookieHeader(), accept: "application/json" },
    json,
    timeoutMs,
  });
  return r;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [method, apiPath, jsonArg] = process.argv.slice(2);
  const r = await lm(method || "GET", apiPath, jsonArg ? JSON.parse(jsonArg) : null);
  console.log(r.status, JSON.stringify(r.json ?? r.text, null, 2).slice(0, 4000));
}
