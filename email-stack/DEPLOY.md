# Email outreach stack — deployment checklist

Existing Dokploy services (`frontend`, `backend` via `Server/`) stay untouched. The email
stack deploys as **one additional Compose service**.

## 1. VPS prerequisites (before anything)

- [ ] VPS with **outbound port 25 open** — Hetzner/DigitalOcean/OVH all gate it; request the
      unlock. If it stays blocked, self-hosted sending is dead on arrival (keep Resend).
- [ ] **≥ 4 GB RAM** free (Postal ~1.5G + MariaDB + Listmonk + Postgres + Console + Reacher)
- [ ] VPS added to Dokploy as a server (same cluster is fine)
- [ ] Pick an **infra hostname** for Postal itself, e.g. `postal.orewirehq.co`
      (the sending domains are separate: getorewire.co, orewirehq.co, …)

## 2. DNS — one wildcard for the whole stack

Add **one** record (or one A record per host if your DNS provider lacks wildcards):

| Type | Name | Value |
|------|------|-------|
| A | `*.emails.orewire.com` | VPS IP |

That single record serves:
- `emails.orewire.com` → Outreach Console (daily driver; header links to the other two)
- `lists.emails.orewire.com` → Listmonk
- `postal.emails.orewire.com` → Postal

⚠️ **Cloudflare users:** set the record to **DNS only (grey cloud)**. The orange-cloud proxy
breaks Traefik's TLS termination and the Let's Encrypt HTTP-01 challenge.

Infra host (once, for Postal's HELO/return-path): `postal.emails.orewire.com` is covered by the
wildcard. Per-domain DKIM/SPF/return-path for the *sending* domains is separate — see §3.

## 3. DNS — per sending domain (getorewire.co, orewirehq.co, …)

Postal shows exact values per domain (Domains → the domain). You will add:
DKIM TXT (`postal._domainkey`), SPF include TXT, return-path MX/TXT, tracking CNAME.
Domains are "verified" in Postal only when these check out — campaigns must not run
before verification.

## 3b. Open / click tracking (track.* hostnames) — required for the opens column

Postal only records an open when the message HTML contains a tracking pixel and that
pixel URL is reachable. Two things must be true:

1. **A TrackDomain per sending domain.** The bootstrap (`postal-bootstrap.rb`) creates
   `track.<sending-domain>` with SSL on and checks DNS, so `dns_status` becomes `OK`
   only when the CNAME resolves to `postal.emails.orewire.com`:

   | Type | Name | Value | Proxy |
   |------|------|-------|-------|
   | CNAME | `track.getorewire.com` | `postal.emails.orewire.com` | DNS only (grey) |
   | CNAME | `track.orewiredata.com` | `postal.emails.orewire.com` | DNS only (grey) |
   | CNAME | `track.orewirehq.com` | `postal.emails.orewire.com` | DNS only (grey) |

   Postal reads `track_domains.dns_status` at send time and only then rewrites links and
   appends `<img src='https://track.<domain>/img/<server>/<message>'>`.

2. **The track hostnames must reach Postal with the `X-Postal-Track-Host: 1` header.**
   Postal's `TrackingMiddleware` is inserted *before* `ActionDispatch::HostAuthorization`
   and only runs when that header is present; otherwise any host that is not
   `postal.web_hostname` gets a bare **403** (which silently kills every open).
   Traefik/Dokploy cannot add request headers, so the stack ships a 20-line nginx
   service (`track-proxy`, see `track-proxy.conf`) that sets the header and proxies to
   `postal-web:5000`. In Dokploy the three track domains therefore point at
   **service `track-proxy`, port `80`**, not at `postal-web:5000`.

   Compose domains in Dokploy are Traefik **labels** — a domain change only takes effect
   on the next deployment, so redeploy the compose service after editing them.

Verify (all three should answer `404 Invalid Server Token`; a 403 means the header never
arrived):

```bash
curl -si https://track.getorewire.com/img/probe/probe | head -n 1
curl -si https://track.getorewire.com/img/probe/probe | tail -n 1
```

End-to-end check: send a message through Postal, open its expanded HTML, fetch the pixel
URL, then confirm the row shows `opened` in the console:

```bash
curl -s -X POST https://postal.emails.orewire.com/api/v1/send/message \
  -H "X-Server-API-Key: $POSTAL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"to":["probe@getorewire.com"],"from":"jonathan@getorewire.com","subject":"probe","html_body":"<p>probe</p>"}'
# then: POST /api/v1/messages/message {"id":<id>,"_expansions":true} -> data.html_body
curl -so /dev/null -w '%{http_code}\n' 'https://track.getorewire.com/img/<server>/<message>'
```

The console's **Sent & opens** table shows `👁 opened` / `🖱 clicked` per message and the
open rate is computed over *trackable* messages only (sent after tracking was wired up).
Dokploy domain changes can be scripted with `outreach/dokploy-add-track-domains.mjs` and
`outreach/dokploy-set-track-domains.mjs` (logs in with `POST /api/auth/sign-in/email`,
then `domain.byComposeId` / `domain.create` / `domain.update` / `compose.deploy`).

## 4. Deploy on Dokploy


- [ ] New service → **Compose** (⚠️ NOT "Application" — Applications expect a Dockerfile and
      fail with `failed to read dockerfile`). Compose file path: `./email-stack/docker-compose.yml`,
      Branch `production`, Trigger On Push, Watch Paths `email-stack/**,outreach/console/**`
- [ ] Fill `.env` values (copy from `.env.example`) in Dokploy's environment editor
      — `EMAIL_DOMAIN` drives the Traefik routing labels
- [ ] Deploy. First boot auto-creates Listmonk schema; Postal schema auto-installs on first UI visit
- [ ] The three UIs attach to Dokploy's `dokploy-network` and expose themselves via Traefik
      labels (TLS resolver: `letsencrypt`); no extra ports published. Verify the network exists:
      `docker network ls | grep dokploy-network`
- [ ] If Dokploy rejects the console's parent-relative build context
      (`../outreach/console`), move `outreach/console/` into `email-stack/console/` and update
      the compose `build:` path — or build/push the image and swap `build:` for `image:`
- [ ] Log in at each host; consider Dokploy basic-auth / IP allow-listing in front of
      Postal + Console (Listmonk has proper logins; the console is single-tenant)

## 5. Post-deploy configuration (one-time)

- [ ] Postal: visit UI → create admin → Organization + mail server (Live mode!) →
      add each sending domain → verify DNS → create SMTP credential
- [ ] Listmonk: login → Settings → SMTP →
      host `console`, port `2526`, auth plain, user/pass = the console-side mailbox creds
      (the console re-auths upstream to Postal itself)
- [ ] Console UI (`:8018`): rename the 9 placeholder mailboxes to real addresses
      (e.g. `hello@getorewire.co`, `team@orewirehq.co`, …), set caps, optionally start warmup
- [ ] Console reply-watch: fill IMAP settings per mailbox provider, enable auto-check
- [ ] Optional: backend service env `ENABLE_PRESEND_VERIFICATION=true` +
      `EMAIL_VERIFIER_URL=http://email-verifier:8080` if OreWire's own transactional
      emails should also verify (needs `email-verifier` reachable from the backend network)

## 6. Warmup & first campaign (per mailbox)

- [ ] Enable warmup in Console for every mailbox (start 2/day, +2/day, max 30)
- [ ] 2–3 weeks: send to friendly/clean addresses, watch Postal bounces
- [ ] Only after warmup: raise caps to 5/day per mailbox (45/day total) and activate
      the staged Week-1 campaigns (import leads with `outreach/import-leads.ps1` pointed
      at the deployed Listmonk, verify with `verify-leads.mjs` + `apply-verification.ps1`,
      campaigns start as drafts)

## Local vs deployed differences

| | Local (now) | Deployed |
|---|---|---|
| Listmonk → sender | `host.docker.internal:2526` | `console:2526` (service name) |
| Console → Postal | `localhost:2525` | `postal-smtp:25` (service name) |
| Postal mode | Development (mail held) | **Live** |
| Domains | placeholder, force-verified | real DNS verification required |
| Mail | nothing leaves the machine | real delivery — warmup first |
