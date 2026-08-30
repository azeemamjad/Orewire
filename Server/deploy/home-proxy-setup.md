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

The server side is a **container**, not host configuration. That matters: it
means no changes to the host's sshd, and no dependence on the docker bridge
gateway address — which changes whenever Dokploy recreates the network. The app
reaches the proxy at the stable service name `tunnel:8888`.

```
laptop ──ssh──▶ server:2222 ──▶ [tunnel container] binds 0.0.0.0:8888
                                        ▲
      orewire-server ──http://tunnel:8888┘ ──▶ (back down the tunnel) ──▶ laptop tinyproxy ──▶ SEDAR+
```

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

### 2. On the server (once, in a panel — no terminal)

Deploy the tunnel container **once**. It needs no key at deploy time.

In **Dokploy**: add a Compose application pointing at
`Server/deploy/home-proxy/docker-compose.tunnel.yml`, and set two variables in
its environment:

| variable | value |
|---|---|
| `OREWIRE_NETWORK` | the docker network the backend already runs on |
| `TUNNEL_KEYS_VOLUME` | the volume the backend mounts at `/keys` (default `orewire_tunnel-keys`) |

The backend also needs that same volume mounted at `/keys` — it is already in
`docker-compose.yml`; in Dokploy add it as a volume mount on the backend app.

That is the only server-side step, and it is a one-off. Everything after this
happens in the OreWire admin panel.

### 2b. Add the key from the admin panel

**Admin → Proxies → Home network tunnel.** Paste the public key that
`laptop-setup.sh` printed and press Save.

The tunnel container resolves keys **per connection**, so this takes effect on
the laptop's next attempt — no redeploy, no restart, no shell. Rotating or
revoking the key is the same form: paste a new one, or press Remove.

The panel only ever accepts a single-line OpenSSH *public* key. Pasting a private
key, or trying to smuggle a second key on another line, is rejected — and the
restriction prefix (`restrict,port-forwarding,permitlisten="0.0.0.0:8888"`) is
applied by the container itself, so a key added through a web form can never
arrive unrestricted.

### 3. Start the tunnel and wire it up

```bash
sudo systemctl start orewire-tunnel      # on the laptop
systemctl status orewire-tunnel --no-pager
```

Admin → Proxies → Add proxy, using the printed values — note **Host is `tunnel`**,
the container's service name, not an IP address. Then edit the Oxylabs row and
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

The tunnel binds `0.0.0.0:8888` **inside the tunnel container**, so that address
exists only on that container's own network interface. It is not on the host, not
on a bridge the host shares, and not reachable from outside. The single published
port is 2222 (ssh), and the key that reaches it can do exactly one thing.

This is also why the container approach is better than tunnelling to the host:
there is no `GatewayPorts` change to make on the host's sshd, and no docker
bridge gateway address to chase when Dokploy recreates the network.

The container's own `sshd_config` sets `GatewayPorts clientspecified` — **not**
`yes`. `yes` would force every remote forward onto an address of its choosing,
overriding the `permitlisten` restriction pinned to the key.

### 2. The SSH key can do nothing except open that one port

The container writes the authorized_keys line itself, so the restriction cannot
be omitted by mistake:

```
restrict,port-forwarding,permitlisten="0.0.0.0:8888" ssh-ed25519 AAAA... orewire-tunnel-laptop
```

- `restrict` disables everything; `port-forwarding` re-enables only forwarding.
- `permitlisten` pins the key to that exact address and port. Note the address
  **must** be written out: a bare `permitlisten="8888"` only matches a request
  for `localhost`, which is not what the laptop asks for.
- The container's sshd additionally sets `AllowTcpForwarding remote`, so `-L` is
  refused — the key cannot be used as a jump host into the rest of the docker
  network — plus `PermitOpen none`, `PermitTTY no`, and a `nologin` shell.

Verified behaviour, from the container's own logs:

```
This account is not available                         # shell refused
remote forward to host 0.0.0.0 port 9999 ... denied   # other ports refused
refused local port forward: ... target 1.1.1.1 port 80 # -L refused
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
  -R 0.0.0.0:8888:127.0.0.1:3128 \
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
