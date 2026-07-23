/**
 * OreWire Bridge — extension popup
 * Paste ngrok authtoken (+ reserved domain) → daemon opens tunnel → copy URL + bridge token for Admin.
 */
(function () {
  const COLORS = {
    connected: '#22c55e',
    connecting: '#f59e0b',
    disconnected: '#ef4444',
    unknown: '#6b7280',
  };

  const DEFAULT_DOMAIN = 'elwanda-liverless-dendritically.ngrok-free.dev';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusDot(status) {
    const color = COLORS[status] || COLORS.unknown;
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle;"></span>`;
  }

  async function getDaemonStatus() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      return r?.status || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function getConnection() {
    try {
      return await chrome.runtime.sendMessage({ type: 'GET_CONNECTION' });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function loadSaved() {
    try {
      return await chrome.storage.local.get(['ngrokDomain', 'ngrokAuthtokenSet']);
    } catch {
      return {};
    }
  }

  async function render() {
    const root = document.getElementById('root');
    const [status, conn, saved] = await Promise.all([
      getDaemonStatus(),
      getConnection(),
      loadSaved(),
    ]);

    const daemonUp = conn.ok !== false && !(conn.error || '').includes('Failed to fetch');
    const publicUrl = conn.publicUrl || '';
    const bridgeToken = conn.bridgeToken || '';
    const domainHint =
      conn.ngrokDomain || saved.ngrokDomain || DEFAULT_DOMAIN;
    const ngrokUp = !!conn.ngrokConnected || !!publicUrl;

    root.innerHTML = `
      <div style="padding:14px 16px;font-family:system-ui,sans-serif;width:360px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <h2 style="margin:0;font-size:16px;font-weight:600;">OreWire Bridge</h2>
          <span style="margin-left:auto;font-size:11px;color:#6b7280;">v0.2.0</span>
        </div>

        <div style="background:#f9fafb;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;margin-bottom:4px;">
            ${statusDot(status)}
            <span style="font-size:13px;font-weight:500;">Daemon: <span id="status-text">${esc(status)}</span></span>
          </div>
          <div style="font-size:12px;color:#6b7280;line-height:1.35;">
            ${
              daemonUp
                ? `Local daemon OK${conn.extensionConnections != null ? ` · ${conn.extensionConnections} link(s)` : ''}${ngrokUp ? ' · tunnel up' : ' · tunnel off'}`
                : 'Start server: <code>cd Server && node index</code> (WEBBRIDGE=1)'
            }
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">
            Reserved ngrok domain
          </label>
          <input id="ngrok-domain" type="text" autocomplete="off"
            value="${esc(domainHint)}"
            placeholder="your-name.ngrok-free.dev"
            style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" />
        </div>

        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">
            ngrok authtoken
          </label>
          <input id="ngrok-token" type="password" autocomplete="off"
            placeholder="${saved.ngrokAuthtokenSet || conn.ngrokConfigured ? 'Saved on daemon — paste to replace' : 'From dashboard.ngrok.com'}"
            style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" />
          <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;line-height:1.35;">
            Uses your reserved domain so the URL stays the same after restart. Copy URL + bridge token into OreWire Admin.
          </p>
        </div>

        <button id="btn-connect" type="button" style="
          width:100%;padding:9px 0;border:none;border-radius:6px;
          background:#111827;color:white;font-size:13px;cursor:pointer;font-weight:600;margin-bottom:12px;
        ">Connect &amp; get URL</button>

        <div id="conn-result" style="
          background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
          padding:10px 12px;margin-bottom:12px;${publicUrl ? '' : 'display:none;'}
        ">
          <div style="font-size:11px;font-weight:600;color:#166534;margin-bottom:6px;">Connection URL</div>
          <div id="public-url" style="font-size:12px;word-break:break-all;color:#14532d;margin-bottom:8px;">${esc(publicUrl)}</div>
          <button id="btn-copy-url" type="button" style="
            width:100%;padding:6px 0;border:1px solid #86efac;border-radius:6px;
            background:white;color:#166534;font-size:12px;cursor:pointer;font-weight:500;margin-bottom:10px;
          ">Copy URL</button>

          <div style="font-size:11px;font-weight:600;color:#166534;margin-bottom:6px;">Bridge token (Admin)</div>
          <div id="bridge-token" style="font-size:11px;word-break:break-all;color:#14532d;font-family:ui-monospace,monospace;margin-bottom:8px;">${esc(bridgeToken)}</div>
          <button id="btn-copy-token" type="button" style="
            width:100%;padding:6px 0;border:1px solid #86efac;border-radius:6px;
            background:white;color:#166534;font-size:12px;cursor:pointer;font-weight:500;
          ">Copy bridge token</button>
        </div>

        <p id="err-msg" style="display:none;margin:0 0 10px;font-size:12px;color:#b91c1c;"></p>

        <div style="display:flex;gap:8px;">
          <button id="btn-reconnect" type="button" style="
            flex:1;padding:7px 0;border:none;border-radius:6px;
            background:#3b82f6;color:white;font-size:12px;cursor:pointer;font-weight:500;
          ">Reconnect daemon</button>
          <button id="btn-refresh" type="button" style="
            flex:1;padding:7px 0;border:1px solid #d1d5db;border-radius:6px;
            background:white;color:#374151;font-size:12px;cursor:pointer;font-weight:500;
          ">Refresh</button>
        </div>
      </div>
    `;

    const errEl = document.getElementById('err-msg');
    const showErr = (msg) => {
      errEl.style.display = 'block';
      errEl.textContent = msg;
    };

    document.getElementById('btn-refresh').addEventListener('click', () => render());

    document.getElementById('btn-reconnect').addEventListener('click', async () => {
      document.getElementById('status-text').textContent = 'connecting...';
      try {
        await chrome.runtime.sendMessage({ type: 'RECONNECT' });
      } catch {
        /* ignore */
      }
      setTimeout(render, 800);
    });

    document.getElementById('btn-connect').addEventListener('click', async () => {
      const domain = document.getElementById('ngrok-domain').value.trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '');
      const authtoken = document.getElementById('ngrok-token').value.trim();
      const btn = document.getElementById('btn-connect');

      if (!domain) {
        showErr('Reserved ngrok domain is required');
        return;
      }
      // Token optional if daemon already has one saved
      if (!authtoken && !conn.ngrokConfigured) {
        showErr('Paste your ngrok authtoken (first time)');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Connecting…';
      errEl.style.display = 'none';

      try {
        await chrome.storage.local.set({ ngrokDomain: domain, ngrokAuthtokenSet: true });
        const result = await chrome.runtime.sendMessage({
          type: 'CONNECT_NGROK',
          authtoken: authtoken || undefined,
          domain,
        });
        if (!result?.ok) throw new Error(result?.error || 'Connect failed');
        document.getElementById('ngrok-token').value = '';
        await render();
      } catch (err) {
        showErr(err instanceof Error ? err.message : String(err));
        btn.disabled = false;
        btn.textContent = 'Connect & get URL';
      }
    });

    const copyUrl = document.getElementById('btn-copy-url');
    if (copyUrl) {
      copyUrl.addEventListener('click', async () => {
        const url = document.getElementById('public-url')?.textContent || '';
        await navigator.clipboard.writeText(url);
        copyUrl.textContent = 'Copied!';
        setTimeout(() => {
          copyUrl.textContent = 'Copy URL';
        }, 1200);
      });
    }
    const copyTok = document.getElementById('btn-copy-token');
    if (copyTok) {
      copyTok.addEventListener('click', async () => {
        const tok = document.getElementById('bridge-token')?.textContent || '';
        await navigator.clipboard.writeText(tok);
        copyTok.textContent = 'Copied!';
        setTimeout(() => {
          copyTok.textContent = 'Copy bridge token';
        }, 1200);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => render());
  render();
})();
