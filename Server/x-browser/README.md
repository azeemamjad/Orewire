# OreWire X Browser

Password-gated Chromium for X/Twitter, embedded in the main OreWire server.

## Production (Dokploy — recommended)

In Dokploy env for the **main** Server service:

```
X_BROWSER_PASSWORD=your-strong-password
HOSTED_BROWSER_POST=1
```

**Do not** set `X_BROWSER_URL=http://127.0.0.1:10088` on that service.

Redeploy, then open:

`https://backend.orewire.com/x-browser/login`

Unlock with the password → **Open X login** → sign in on the live screen.

Admin → **X Browser** → Start / status uses the same in-process browser.

Ensure the Docker image can run Playwright Chromium (this project’s Playwright base image, or run `npx playwright install chromium` in the image).

## Optional standalone process

```bash
cd Server && npm run x-browser
```

Only needed if the browser runs on a **different** host. Then set `X_BROWSER_URL` + `X_BROWSER_TOKEN` on OreWire and `X_BROWSER_EMBED=0`.
