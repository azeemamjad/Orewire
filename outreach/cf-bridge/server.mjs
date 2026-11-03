// CF Bridge: local WebSocket <-> HTTP bridge.
// The Tampermonkey userscript in the user's browser connects to ws://localhost:8765.
// I submit commands via HTTP POST http://localhost:8766/execute and get the
// page-authenticated Cloudflare API results back.
import { WebSocketServer } from "ws";
import http from "node:http";

let client = null;
const pending = new Map();
let seq = 0;

const wss = new WebSocketServer({ port: 8765 });
wss.on("connection", (ws) => {
  if (client) { try { client.close(); } catch {} }
  client = ws;
  console.log("[bridge] BROWSER CONNECTED");
  ws.on("message", (d) => {
    let m;
    try { m = JSON.parse(d); } catch { return; }
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); p(m); }
  });
  ws.on("close", () => { if (client === ws) { client = null; console.log("[bridge] browser disconnected — waiting for reconnect"); } });
  ws.on("error", () => {});
});
wss.on("error", () => {});

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/execute") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      if (!client) { res.writeHead(503); return res.end(JSON.stringify({ error: "no browser connected (open dash.cloudflare.com with the userscript enabled)" })); }
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end("bad json"); }
      const id = String(++seq);
      msg.id = id;
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); res.writeHead(504); res.end(JSON.stringify({ error: "timeout" })); }
      }, 120000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(m));
      });
      client.send(JSON.stringify(msg));
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(8766, () => console.log("[bridge] HTTP control on http://localhost:8766/execute"));
