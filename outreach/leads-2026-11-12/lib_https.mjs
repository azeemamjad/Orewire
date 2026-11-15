// Tiny HTTPS JSON client with a resilient resolver (this laptop's LAN DNS
// intermittently returns EAI_AGAIN for *.orewire.com).
import https from "node:https";
import dns from "node:dns";

const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const ipCache = new Map();

export async function resolveHost(host) {
  if (ipCache.has(host)) return ipCache.get(host);
  let ip = null;
  try {
    const a = await dns.promises.lookup(host, { family: 4 });
    ip = a.address;
  } catch {
    try {
      const a = await resolver.resolve4(host);
      ip = a && a.length ? a[0] : null;
    } catch {
      ip = null;
    }
  }
  if (ip) ipCache.set(host, ip);
  return ip;
}

export function request(urlStr, { method = "GET", headers = {}, body = null, timeoutMs = 60000 } = {}) {
  const url = new URL(urlStr);
  const host = url.hostname;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        servername: host,
        autoSelectFamily: false,
        lookup: (h, opts, cb) => {
          resolveHost(h)
            .then((ip) => {
              if (!ip) return cb(new Error(`cannot resolve ${h}`));
              if (opts && opts.all) cb(null, [{ address: ip, family: 4 }]);
              else cb(null, ip, 4);
            })
            .catch((e) => cb(e));
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function jsonRequest(urlStr, { method = "GET", headers = {}, json = null, timeoutMs = 60000 } = {}) {
  const body = json === null ? null : JSON.stringify(json);
  const h = { ...headers };
  if (body) h["content-type"] = "application/json";
  if (body) h["content-length"] = Buffer.byteLength(body);
  const r = await request(urlStr, { method, headers: h, body, timeoutMs });
  return r;
}
