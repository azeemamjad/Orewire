// ==UserScript==
// @name         OreWire CF Bridge
// @namespace    orewire
// @version      1.0
// @description  Local bridge: lets the Outreach Console driver execute Cloudflare DNS API calls from your logged-in dashboard session. Runs only on dash.cloudflare.com and talks only to ws://localhost:8765.
// @match        https://dash.cloudflare.com/*
// @match        https://*.dash.cloudflare.com/*
// @grant        none
// ==/UserScript==
(function () {
  "use strict";
  let ws;
  let seq = 0;

  function connect() {
    ws = new WebSocket("ws://localhost:8765");
    ws.onopen = () => console.log("[cf-bridge] connected to local bridge");
    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const out = { id: msg.id };
      try {
        if (msg.cmd === "ping") {
          out.result = "pong";
        } else if (msg.cmd === "zoneId") {
          const r = await fetch(`/api/v4/zones?name=${encodeURIComponent(msg.name)}`, { credentials: "include" });
          const j = await r.json();
          out.result = j.result && j.result[0] ? j.result[0].id : null;
        } else if (msg.cmd === "createRecords") {
          out.results = [];
          for (const rec of msg.records) {
            const r = await fetch(`/api/v4/zones/${msg.zoneId}/dns_records`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                type: rec.type,
                name: rec.name,
                content: rec.content,
                ttl: 1,
                proxied: false,
                priority: rec.type === "MX" ? (rec.priority || 10) : undefined,
              }),
            });
            const j = await r.json();
            out.results.push({ name: rec.name, type: rec.type, success: j.success, errors: j.errors });
          }
        }
      } catch (e) {
        out.error = String(e);
      }
      ws.send(JSON.stringify(out));
    };
    ws.onclose = () => setTimeout(connect, 3000);
    ws.onerror = () => {};
  }

  connect();
})();
