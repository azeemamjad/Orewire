# OreWire WebBridge — VA laptop setup

Everything runs from **`Server/`** with one `node_modules` and `node index.js`.  
No separate pnpm project.

## What runs where

| Machine | Command | Role |
|---------|---------|------|
| **VA laptop** | `WEBBRIDGE=1 npm start` (or `npm run webbridge`) | OreWire server **plus** Chrome bridge + ngrok |
| **Dokploy / production** | `npm start` (no `WEBBRIDGE`) | Admin + cron; posts by calling your laptop’s public bridge URL |

## 1. Install deps (Server only)

```bash
cd Server
npm install
```

## 2. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (absolute path on your machine):

   ```
   …/Orewire/Server/public/webbridge-extension
   ```

5. You should see **OreWire Bridge**
6. Open [x.com](https://x.com) and **log in** as the OreWire account — leave that window open

Reload the extension after any git pull that updates `public/webbridge-extension/`.

## 3. Start the bridge (same Node process as the server)

```bash
cd Server
npm run webbridge
# same as: WEBBRIDGE=1 node index.js
```

You should see logs like:

- `Mining Intel server running → http://localhost:3000`
- `[webbridge] WS  ws://127.0.0.1:10086`
- `[webbridge] HTTP http://127.0.0.1:10087`
- `[webbridge] Extension folder: …/public/webbridge-extension`

Pin the OreWire Bridge extension → click it → status should show **connected** (daemon linked).

## 4. Paste ngrok authtoken in the extension

1. Get an authtoken: [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
2. (Recommended) Claim a **static domain** in the ngrok dashboard so the URL stays the same after restart
3. In the extension popup:
   - Paste **ngrok authtoken**
   - Click **Connect & get URL**
4. Copy:
   - **Connection URL** (e.g. `https://….ngrok-free.app`)
   - **Bridge token**

## 5. Paste into OreWire Admin (production)

Admin → **Social Automation** → **WebBridge connection**:

1. Bridge URL = Connection URL  
2. Token = Bridge token  
3. **Test connection** → OK  
4. Uncheck Dry run → **Play** / **Run now**

Production cron will call that URL; your laptop must stay online with Chrome + `npm run webbridge`.

## Daily checklist (before 8:00 America/Toronto)

1. Chrome open, logged into X  
2. Extension loaded, popup shows connected  
3. `cd Server && npm run webbridge` running  
4. Tunnel up (popup shows Connection URL)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension “disconnected” | Restart `npm run webbridge`; click **Reconnect daemon** in popup |
| Connect ngrok fails | Check authtoken; claim a static domain if domain error |
| Admin Test connection fails | Laptop offline / wrong URL / wrong bridge token / ngrok down |
| Post fails | Be logged into X in Chrome; don’t close the compose tab mid-run |

## Layout (all under Server/)

```
Server/
  index.js                 # WEBBRIDGE=1 also starts the bridge
  package.json             # only node_modules lives here
  lib/webbridge/           # bridge daemon (CommonJS)
  public/webbridge-extension/   # load this folder in Chrome
```
