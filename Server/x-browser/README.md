# OreWire X Browser (standalone)

Persistent Chromium on this machine for X/Twitter automation. VAs log in through a **password-gated webpage** (remote screen + mouse/keyboard). OreWire posts via HTTP + Bearer token.

## Run (separate from main OreWire server)

```bash
cd Server
# once
npx playwright install chromium

# in .env
X_BROWSER_PASSWORD=choose-a-strong-password
# optional:
# X_BROWSER_PORT=10088
# X_BROWSER_PROFILE=~/.orewire-x-browser

npm run x-browser
```

Open **http://SERVER:10088/login** → enter password → **Open X login** → sign in on the live screen.

## OreWire wiring

On start, the service prints an API token (also in `~/.orewire-x-browser/api-token.txt`).

In OreWire `.env` / Admin Social Automation bridge fields:

```
X_BROWSER_URL=http://127.0.0.1:10088
X_BROWSER_TOKEN=<token from x-browser>
HOSTED_BROWSER_POST=1
```

Or paste the URL + token into Social Automation → WebBridge settings (same client path).

## API

- `GET /api/status` — Bearer
- `POST /api/post` `{ "tweets": ["…"] }` — Bearer
- `POST /api/tool` `{ "name": "post_x_thread", "args": { "tweets": [] } }` — Bearer
- Viewer uses cookie session after `/api/login`
