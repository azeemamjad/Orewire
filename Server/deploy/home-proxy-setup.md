# Home network as the primary proxy

Route SEDAR+ traffic through your home connection (free, real residential IP) and
keep Oxylabs as a standby that only gets used when the home link is down.

Your home IP already passes SEDAR+ — every successful test of the relay browser
stack ran over it.

```
Dokploy container ──▶ <docker-gateway>:8888 ──[ssh reverse tunnel]──▶ home:3128 ──▶ SEDAR+
```

## You do not need a public IP

**CGNAT is fine.** This is the reason the tunnel runs in this direction.

CGNAT blocks *inbound* connections. Nothing here ever connects to your home. The
home machine opens an ordinary **outbound** connection to the server — the same
kind of connection your browser makes to load a website — and `ssh -R` carries
the proxy traffic backwards over that already-established link.

So: no public IP, no static IP, no DDNS, no port forwarding, no router changes,
and nothing listening on your home connection. If your machine can browse the
web, this works.

Two CGNAT-specific things to know:

- **Your exit IP is shared** with other subscribers on your ISP. That helps you
  blend in, but it also means you inherit that address's reputation — and the
  mapping can change. The relay re-resolves locale/timezone per proxy (cached 6h),
  so a changed exit corrects itself.
- **NAT tables drop idle connections.** The `ServerAliveInterval=30` in the
  systemd unit below keeps the tunnel warm; without it CGNAT would silently drop
  it after a few minutes of quiet.

If your ISP blocks outbound port 22 (uncommon, but it happens), run sshd on 443
on the server as well — add `Port 443` to `sshd_config` — and point the tunnel at
`-p 443`. Outbound 443 is never blocked.

---

---

## Setup, step by step

The SSH endpoint runs **inside the backend container**. No host configuration, no
second app to deploy, and no cross-container networking — which matters because
the backend deploys as a single Dokploy *Dockerfile application*, not a Compose
stack.

```
laptop ──ssh──▶ backend.orewire.com:2222 ──▶ sshd inside orewire-server
                                                     │ binds 127.0.0.1:8888
      Chrome (same container) ──http://127.0.0.1:8888┘ ──▶ back down the tunnel
                                                        ──▶ laptop tinyproxy ──▶ SEDAR+
```

The forwarded port exists only on that container's **loopback** — not on the
host, not on any shared network. And because the admin panel and sshd live in the
same container, there is no shared volume to misconfigure: the panel writes the
key exactly where sshd reads it.

### 1. On the laptop (once)

```bash
cd Server/deploy/home-proxy
sudo SERVER_HOST=backend.orewire.com bash laptop-setup.sh
```

Installs and locks down tinyproxy, generates a proxy password and an SSH key used
for nothing else, and installs a systemd service. Before finishing it runs three
live checks and **refuses to continue** unless all three behave:

| check | must be |
|---|---|
| sedarplus.ca *with* credentials | `200` |
| sedarplus.ca *without* credentials | `407` |
| example.com *with* credentials | `403` |

If check 2 or 3 passes traffic, the proxy is open and the script aborts rather
than leave you exposed.

It prints your **public key**, a **proxy password**, and the admin values.
Save the password — it is not stored anywhere else in readable form.

The tunnel starts at boot by default. For on-demand only, pass `ENABLE_AT_BOOT=0`
and start it yourself with `sudo systemctl start orewire-tunnel`.

### 2. On the server (once, in Dokploy's UI — no terminal)

Two settings on the **existing backend application**, then redeploy:

| setting | value |
|---|---|
| **Ports** | Published `2222` → Target `2222`, TCP, mode **Ingress** |
| **Volumes** | a persistent volume mounted at `/app/data` |

Use **Ingress**, not Host. Host mode binds the port directly to the container,
which sounds like the better fit — but Swarm then cannot replace the old task
during a deploy (it still holds the port), so every deploy needs a manual
stop/start. With a single replica there is nothing for ingress to load-balance
across, and the tunnel's 30s keepalives on both ends stop the routing mesh from
dropping it as idle.

Note this assumes **one replica**. Scale the backend past one and the tunnel
terminates in whichever container the laptop reached; the others find nothing on
`127.0.0.1:8888` and fail over to the paid proxy. Host mode does not solve that
either — only one task could bind the port at all.

Adding a **Domain** does not publish a TCP port: a Domain creates a Traefik HTTP
router, which terminates TLS on 443 and speaks HTTP to the container. SSH is not
HTTP, so it does nothing here.

The volume is what makes the key and the SSH host key survive a redeploy. Without
it the panel will warn you, rather than silently losing the key on the next
deploy.

Redeploy so the image is rebuilt with sshd included. That is the entire
server-side step, and it is a one-off — everything after this is the admin panel.

Set `TUNNEL_SSHD=0` in the app's environment to disable the endpoint entirely.

### 2b. Add the key from the admin panel

**Admin → Proxies → Home network tunnel.** Paste the public key that
`laptop-setup.sh` printed and press Save.

sshd resolves keys **per connection**, so this takes effect on
the laptop's next attempt — no redeploy, no restart, no shell. Rotating or
revoking the key is the same form: paste a new one, or press Remove.

The panel only ever accepts a single-line OpenSSH *public* key. Pasting a private
key, or trying to smuggle a second key on another line, is rejected — and the
restriction prefix (`restrict,port-forwarding,permitlisten="localhost:8888"`) is
applied by sshd itself, so a key added through a web form can never
arrive unrestricted.

### 3. Start the tunnel and wire it up

```bash
sudo systemctl start orewire-tunnel      # on the laptop
systemctl status orewire-tunnel --no-pager
```

Admin → Proxies → Add proxy, using the printed values — note **Host is `tunnel`**,
the backend container's own loopback. Then edit the Oxylabs row and
tick **Fallback only**.

Verify end to end:

```bash
docker exec orewire-server npm run relay:diagnose-proxies
docker exec orewire-server node scripts/test-stealth.js --proxy res --flow sedar
```

---

## Roaming: laptop on, laptop off, office WiFi

The service is `WantedBy=multi-user.target` with `Restart=always`, so:

- **Boot the laptop** → tunnel comes up on its own, before you log in. The
  scraper starts using your connection with no action from you.
- **Change network** (home → office → hotspot) → autossh notices the dead
  connection within ~90s (`ServerAliveInterval=30 × 3`) and reconnects over the
  new one. Your exit IP changes with it; the relay re-resolves timezone/locale
  per proxy so the browser stays consistent with wherever you are.
- **Close the lid / suspend** → the connection dies, `Restart=always` brings it
  back on resume.
- **Laptop off** → the relay sees transport failures, takes the home proxy out of
  rotation after 3 of them, and fails over to Oxylabs. When you turn the laptop
  back on, the cooldown expires and it returns to the free path by itself. You do
  not have to touch anything in either direction.

Useful commands:

```bash
systemctl status orewire-tunnel        # is it up?
journalctl -u orewire-tunnel -f        # why isn't it up?
sudo systemctl stop orewire-tunnel     # force the relay onto Oxylabs
```

**If the office blocks outbound port 22** — corporate firewalls sometimes do —
add `Port 443` to the server's `sshd_config`, reload sshd, and re-run
`laptop-setup.sh` with `SSH_PORT=443`. Outbound 443 is never blocked.

Two things to weigh about using the office connection: it is your employer's
network and their IP that SEDAR+ will see and may rate-limit, and their IT may
well notice a long-lived tunnel. Worth a conversation before you rely on it. If
you would rather not, stop the service while at work — the failover handles it.

---

## Security: four independent gates

This is what the scripts set up, and why each layer is there.

An HTTP proxy reachable from the public internet is found by scanners within
hours and used to send spam, at which point *your home IP* is the one that gets
blacklisted. Any single one of these gates prevents that; use all four.

### 1. The forwarded port never touches the host

The tunnel binds port 8888 on the **backend container's loopback**. Not the
host, not a shared network, not any interface reachable from outside — only
processes inside that container (i.e. Chrome) can use it. `GatewayPorts` is left
at its default (off) precisely so the forward cannot be moved off loopback.

The single publicly published port is 2222 (ssh), and the key that reaches it can
do exactly one thing.

### 2. The SSH key can do nothing except open that one port

sshd resolves keys through `AuthorizedKeysCommand`, which builds the line itself —
so the restriction cannot be omitted by mistake, however the key was supplied:

```
restrict,port-forwarding,permitlisten="localhost:8888" ssh-ed25519 AAAA... orewire-tunnel-laptop
```

- `restrict` disables everything; `port-forwarding` re-enables only forwarding.
- `permitlisten` pins the key to that one port. The address form matters: ssh
  sends the hostname `localhost` when the client asks for a bare `-R 8888:…`,
  and that is treated as distinct from `127.0.0.1`, so the two sides have to
  agree. They do: the client uses a bare port, the server permits `localhost:8888`.
- `AllowTcpForwarding remote` means `-L` is refused, so the key cannot be used as
  a jump host into the container or anything it can reach — plus `PermitOpen none`,
  `PermitTTY no`, and a `nologin` shell.

Verified against the built image:

```
This account is currently not available.              # shell refused
remote port forwarding failed for listen port 9999    # any other port refused
-L through the tunnel -> 000                          # local forwarding refused
CONNECT=200 via 127.0.0.1:8888                        # the permitted forward works
```

### 3. The proxy requires credentials

Even inside the container network, make the proxy prove-who-you-are. `browser_proxies`
already has `username`/`password` columns, so this costs no code.

`/etc/tinyproxy/tinyproxy.conf` on the **home** machine:

```
Port 3128
Listen 127.0.0.1          # never reachable from your LAN or the internet
Allow 127.0.0.1           # only the far end of the ssh tunnel
BasicAuth orewire <a-long-random-password>
DisableViaHeader Yes
LogLevel Warning
```

Put that same username/password on the proxy row in Admin → Proxies. Leave
**Sessid blank** — it is an Oxylabs-only field, and filling it rewrites the
username into `customer-…-sessid-…`.

### 4. The proxy can only reach SEDAR+

The strongest gate: even a fully authenticated attacker can reach nothing worth
having. Add to `tinyproxy.conf`:

```
Filter "/etc/tinyproxy/allowed-hosts.txt"
FilterType ere            # extended regex — the patterns below need it
FilterDefaultDeny Yes
```

`FilterType` takes a regex flavour (`bre` / `ere` / `fnmatch`), not a target.
Leave `FilterURLs` unset so filtering happens on the **host**, which is the
default. `FilterType` needs tinyproxy 1.11+; if your build rejects it, use
`FilterExtended On` instead — same effect, older spelling.

`/etc/tinyproxy/allowed-hosts.txt`:

```
^([a-z0-9-]+\.)*sedarplus\.ca$
^([a-z0-9-]+\.)*perfdrive\.com$
^fonts\.googleapis\.com$
^fonts\.gstatic\.com$
^([a-z0-9-]+\.)*googletagmanager\.com$
^browser-update\.org$
^api\.ipify\.org$
^ip-api\.com$
```

Two of these are not obvious and both matter:

- **`perfdrive.com` must be allowed.** That is where SEDAR+'s Radware wall
  redirects a challenged session. Block it and the challenge page cannot load at
  all, so the relay's captcha flow has nothing for a human to solve — the run
  just dies with a proxy error.
- **The asset hosts must be allowed** (fonts, tag manager, browser-update). They
  are the third-party requests a real visit to SEDAR+ makes; measured, they are
  ~8% of a cold page load. Blocking them changes how the page behaves in ways the
  page's own JS can observe, which is the same detection risk as blocking images.
  The point of this list is to make the proxy worthless to an abuser, not to save
  bytes — the download ledger already did that.

Still useless to an abuser: no SMTP, no arbitrary HTTP, nothing but this one
workflow. Add `asx.com.au` / `thecse.com` only if you route those scrapers
through here too.

`sudo systemctl restart tinyproxy` and verify the deny actually bites:

```bash
curl -x http://orewire:PASSWORD@127.0.0.1:3128 https://example.com/   # must FAIL
curl -x http://orewire:PASSWORD@127.0.0.1:3128 https://www.sedarplus.ca/home/ -o /dev/null -w '%{http_code}\n'
curl -x http://127.0.0.1:3128 https://www.sedarplus.ca/home/          # must fail: no credentials
```

If the first or third command succeeds, stop and fix it before going further.

---

## Reference: the systemd unit

`laptop-setup.sh` writes this for you. Shown here so you can see what is running
and adjust it. `/etc/systemd/system/orewire-tunnel.service`:

```ini
[Unit]
Description=OreWire reverse proxy tunnel
After=network-online.target tinyproxy.service
Wants=network-online.target

[Service]
User=YOUR_LOGIN
ExecStart=/usr/bin/autossh -M 0 -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
  -i /home/YOUR_LOGIN/.ssh/orewire-tunnel \
  -p 2222 \
  -R 8888:127.0.0.1:3128 \
  tunnel@backend.orewire.com
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`-M 0` disables autossh's own monitor port; the `ServerAlive` options do the
liveness check instead, which is what survives CGNAT dropping an idle NAT entry.

`ExitOnForwardFailure=yes` matters more than it looks: without it, a failed bind
leaves a *connected* session that forwards nothing, and the relay sees a silent
black hole instead of a clean failure it can fail over from.

---

## How failover behaves

- A proxy is dropped from rotation after `RELAY_PROXY_FAILURES_BEFORE_COOLDOWN`
  (3) consecutive **transport** failures, for `RELAY_PROXY_COOLDOWN_MS` (10 min),
  then retried. Any success resets the streak, so one flaky request never strands it.
- A 403 or bot wall does **not** count. That is SEDAR+ throttling you, and
  switching to a paid proxy would spend money without fixing anything.
- While every primary is cooling down, traffic goes to the fallback and the relay
  logs which proxy it fell back to and why.
- Admin → Relay shows `coolingDown` per worker, so you can see at a glance whether
  paid traffic is flowing.

## Things to watch

- **Upload is the bottleneck.** PDFs travel SEDAR+ → home → server, so they leave
  over your home *upload*. At 20 Mbps that is ~2.5 MB/s; with the download ledger
  skipping everything already held, a normal incremental run moves very little.
- **One IP, many searches.** Oxylabs rotates exits; your home IP does not. Expect
  more 403s than before — the pipeline retries with backoff, but consider lowering
  `concurrency` and raising the per-company delays.
- **It is your home IP.** If SEDAR+ blocks it, your own browsing is affected too.
- Check your ISP's terms; some prohibit running proxies.
