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
| A | `*.email.yourdomain` | VPS IP |

That single record serves:
- `console.email.yourdomain` → Outreach Console (daily driver; header links to the other two)
- `lists.email.yourdomain` → Listmonk
- `postal.email.yourdomain` → Postal

Infra host (once, for Postal's HELO/return-path): `postal.email.yourdomain` is covered by the
wildcard. Per-domain DKIM/SPF/return-path for the *sending* domains is separate — see §3.

## 3. DNS — per sending domain (getorewire.co, orewirehq.co, …)

Postal shows exact values per domain (Domains → the domain). You will add:
DKIM TXT (`postal._domainkey`), SPF include TXT, return-path MX/TXT, tracking CNAME.
Domains are "verified" in Postal only when these check out — campaigns must not run
before verification.

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
