#!/usr/bin/env bash
#
# Run ONCE on the laptop, as root (sudo).
#
# Sets up the proxy + a tunnel that starts at boot and reconnects on its own, so
# the scraper uses your connection whenever the laptop is on — at home, at the
# office, or on a hotspot. When the laptop is off, the relay fails over to the
# paid proxy by itself.
#
#   sudo SERVER_HOST=backend.orewire.com bash laptop-setup.sh
#
# By default the tunnel starts at boot. For on-demand only, pass ENABLE_AT_BOOT=0
# and start it yourself with:  sudo systemctl start orewire-tunnel
#
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-}"
TUNNEL_USER="${TUNNEL_USER:-tunnel}"        # the sshd user inside the backend container
SSH_PORT="${SSH_PORT:-2222}"                # port 2222 published on the backend app
TUNNEL_PORT="${TUNNEL_PORT:-8888}"          # bound on that container's loopback
PROXY_PORT="${PROXY_PORT:-3128}"
PROXY_USER="${PROXY_USER:-orewire}"
ENABLE_AT_BOOT="${ENABLE_AT_BOOT:-1}"
# Force IPv4. If the host has AAAA records and this machine has no IPv6 route,
# ssh tries the v6 address first and dies with "Network is unreachable" — which
# reads like the server is down rather than a local routing gap.
# Set SSH_FAMILY="" to let ssh choose, or "-6" to force IPv6.
SSH_FAMILY="${SSH_FAMILY:--4}"
RUN_AS="${RUN_AS:-${SUDO_USER:-$(logname 2>/dev/null || echo root)}}"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root (sudo ... bash $0)"
[[ -n "$SERVER_HOST" ]] || die "set SERVER_HOST=backend.orewire.com"
id -u "$RUN_AS" >/dev/null 2>&1 || die "user '$RUN_AS' not found — set RUN_AS=<your login>"

HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
KEY="$HOME_DIR/.ssh/orewire-tunnel"

echo "== 1. Install tinyproxy + autossh =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq tinyproxy autossh openssh-client curl >/dev/null
echo "   installed"

echo
echo "== 2. Configure tinyproxy =="
# Reuse the existing password when re-running, so the value already pasted into
# Admin -> Proxies keeps working. FORCE_NEW_PROXY_PASSWORD=1 rotates it.
PROXY_PASS=""
if [[ "${FORCE_NEW_PROXY_PASSWORD:-0}" != "1" && -f /etc/tinyproxy/tinyproxy.conf ]]; then
  PROXY_PASS="$(awk '/^[[:space:]]*BasicAuth[[:space:]]/ {print $3; exit}' /etc/tinyproxy/tinyproxy.conf || true)"
  [[ -n "$PROXY_PASS" ]] && echo "   reusing the existing proxy password (FORCE_NEW_PROXY_PASSWORD=1 to rotate)"
fi
[[ -n "$PROXY_PASS" ]] || PROXY_PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
CONF=/etc/tinyproxy/tinyproxy.conf
[[ -f "$CONF" ]] || die "$CONF not found — is tinyproxy installed?"
cp "$CONF" "$CONF.orewire.bak.$(date +%s)"

# Edit the shipped config rather than replacing it. Distro packages set things
# their own systemd unit depends on (User, PidFile, LogFile); a wholesale
# overwrite is how you end up with a service that will not start.
disable_directive() {   # comment out every existing line for a directive
  sed -i -E "s/^([[:space:]]*)($1[[:space:]].*)$/\1#\2/I" "$CONF"
}
for d in Listen Allow BasicAuth DisableViaHeader Filter FilterType FilterExtended FilterURLs FilterDefaultDeny Port; do
  disable_directive "$d"
done

cat >> "$CONF" <<EOF

# ---- OreWire relay proxy (added by laptop-setup.sh) ----
Port $PROXY_PORT
# Loopback only: reachable solely through the far end of the ssh tunnel, never
# from your LAN, an office network, a café, or the internet.
Listen 127.0.0.1
Allow 127.0.0.1
BasicAuth $PROXY_USER $PROXY_PASS
DisableViaHeader Yes
# Destination allowlist — even an authenticated attacker can reach nothing else,
# which is what makes this proxy worthless to abuse.
Filter "/etc/tinyproxy/allowed-hosts.txt"
FilterType ere
FilterDefaultDeny Yes
EOF

# perfdrive is the bot-wall host SEDAR+ redirects to — block it and a challenged
# session cannot load the page a human needs to solve. The font/tag hosts are
# what a real visit fetches; dropping them changes observable page behaviour.
cat > /etc/tinyproxy/allowed-hosts.txt <<'EOF'
^([a-z0-9-]+\.)*sedarplus\.ca$
^([a-z0-9-]+\.)*perfdrive\.com$
^fonts\.googleapis\.com$
^fonts\.gstatic\.com$
^([a-z0-9-]+\.)*googletagmanager\.com$
^browser-update\.org$
^api\.ipify\.org$
^ip-api\.com$
EOF

systemctl enable tinyproxy >/dev/null 2>&1 || true
if ! systemctl restart tinyproxy 2>/dev/null || ! sleep 1 || ! systemctl is-active --quiet tinyproxy; then
  # FilterType needs tinyproxy 1.11+. Older builds spell it FilterExtended.
  echo "   tinyproxy rejected 'FilterType' — retrying with the older 'FilterExtended On'"
  sed -i -E 's/^FilterType ere$/FilterExtended On/' "$CONF"
  systemctl restart tinyproxy
  sleep 1
fi
systemctl is-active --quiet tinyproxy \
  || die "tinyproxy will not start — see: journalctl -u tinyproxy -n 40"
echo "   running on 127.0.0.1:$PROXY_PORT"

echo
echo "== 3. Verify the gates actually bite =="
# For an https:// URL through a proxy, curl issues CONNECT. If the proxy refuses,
# there is no response from the origin at all, so %{http_code} is 000 and the
# proxy's own answer lands in %{http_connect}. Checking http_code alone reports a
# correctly-refusing proxy as a failure.
#
# Note also: no `|| echo` fallback here. curl's -w still prints on failure, so a
# fallback would concatenate and produce nonsense like "000000".
probe() {  # $1 = url, $2 = "auth" | "noauth"  -> prints "<http_code> <http_connect>"
  local px="http://127.0.0.1:$PROXY_PORT"
  [ "$2" = "auth" ] && px="http://$PROXY_USER:$PROXY_PASS@127.0.0.1:$PROXY_PORT"
  curl -s -o /dev/null --max-time 25 -x "$px" -w '%{http_code} %{http_connect}' "$1" || true
}

read -r ok_code   ok_conn   <<<"$(probe https://www.sedarplus.ca/home/ auth)"
read -r na_code   na_conn   <<<"$(probe https://www.sedarplus.ca/home/ noauth)"
read -r den_code  den_conn  <<<"$(probe https://example.com/ auth)"

printf '   %-34s CONNECT=%-4s response=%-4s (want CONNECT 200)\n' "sedarplus.ca with credentials" "$ok_conn"  "$ok_code"
printf '   %-34s CONNECT=%-4s response=%-4s (want CONNECT 407)\n' "sedarplus.ca without creds"   "$na_conn"  "$na_code"
printf '   %-34s CONNECT=%-4s response=%-4s (want CONNECT 403)\n' "example.com with credentials" "$den_conn" "$den_code"

# The origin may answer 200 or a redirect depending on locale/session, so accept
# any non-error status once the tunnel is open.
[[ "$ok_conn" == "200" && "$ok_code" =~ ^[23] ]] \
  || die "proxy cannot reach SEDAR+ (CONNECT=$ok_conn response=$ok_code) — check the allowlist and Allow/BasicAuth lines"
[[ "$na_conn" == "407" ]] \
  || die "proxy did NOT demand credentials (CONNECT=$na_conn) — do not continue; check the BasicAuth line"
[[ "$den_conn" == "403" ]] \
  || die "proxy reached a non-allowlisted host (CONNECT=$den_conn) — do not continue; check Filter/FilterDefaultDeny"
echo "   all three gates behave correctly"

echo
echo "== 3b. Can this machine actually reach the tunnel port? =="
# Worth checking before installing a service that would otherwise retry forever.
_t0=$(date +%s%N)
if timeout 12 bash -c "echo > /dev/tcp/$SERVER_HOST/$SSH_PORT" 2>/dev/null; then
  echo "   ${SERVER_HOST}:${SSH_PORT} is reachable"
else
  _ms=$(( ($(date +%s%N) - _t0) / 1000000 ))
  echo "   ${SERVER_HOST}:${SSH_PORT} is NOT reachable."
  # A refused connection comes back instantly with an RST; a firewall silently
  # drops the packets and the connect runs to timeout. Very different fixes.
  if [ "$_ms" -ge 5000 ]; then
    echo "   The connection was dropped, not refused (${_ms}ms) — a firewall is blocking"
    echo "   port ${SSH_PORT}. Open it in your provider's firewall panel (and in ufw on the"
    echo "   server if it is enabled), as well as publishing it on the app."
  else
    echo "   The connection was refused immediately (${_ms}ms) — the host is reachable but"
    echo "   nothing is listening. Publish port ${SSH_PORT} on the backend app in Dokploy"
    echo "   (Advanced -> Ports, published ${SSH_PORT} -> target ${SSH_PORT}); note that adding"
    echo "   a Domain does NOT publish a TCP port."
  fi
  # A CDN-proxied hostname is the classic cause: the name resolves to the CDN,
  # which forwards HTTP/HTTPS only and silently drops everything else.
  cdn="$(curl -sS -I --max-time 10 "https://$SERVER_HOST/" 2>/dev/null \
        | tr -d '\r' | awk 'tolower($1)=="server:"{print $2}')"
  case "$(printf '%s' "$cdn" | tr 'A-Z' 'a-z')" in
    cloudflare|*cloudflare*)
      echo
      echo "   >>> \"$SERVER_HOST\" is proxied through Cloudflare."
      echo "       Cloudflare forwards HTTP/HTTPS only — it will never carry port $SSH_PORT,"
      echo "       whatever you publish in Dokploy. Point this tunnel at the origin instead:"
      echo "         - add a DNS-only (grey cloud) record, e.g. ssh.orewire.com -> your server IP"
      echo "         - then re-run with SERVER_HOST=ssh.orewire.com"
      echo "       Also publish $SSH_PORT on the app in Dokploy and open it in the server firewall."
      ;;
    *)
      echo "       Publish port $SSH_PORT on the backend app in Dokploy, and open it in the"
      echo "       server's firewall. If the name sits behind a CDN or load balancer, point"
      echo "       SERVER_HOST at the origin host instead."
      ;;
  esac
  echo
  echo "   Continuing anyway — the service retries, so it will connect once this is fixed."
fi

echo
echo "== 4. SSH key (used for nothing else) =="
if [[ -f "$KEY" ]]; then
  echo "   reusing $KEY"
else
  sudo -u "$RUN_AS" ssh-keygen -t ed25519 -N '' -f "$KEY" -C "orewire-tunnel-$(hostname)" >/dev/null
  echo "   created $KEY"
fi
PUBKEY="$(cat "$KEY.pub")"

echo
echo "== 5. Boot-time tunnel service =="
cat > /etc/systemd/system/orewire-tunnel.service <<EOF
[Unit]
Description=OreWire reverse proxy tunnel
Documentation=file://$PWD/README
After=network-online.target tinyproxy.service
Wants=network-online.target
Requires=tinyproxy.service

[Service]
User=$RUN_AS
# -M 0 disables autossh's own monitor port; the ServerAlive options do the
# liveness check instead, which is what survives CGNAT dropping an idle NAT entry.
# ExitOnForwardFailure matters: without it a failed bind leaves a connected
# session forwarding nothing, and the relay sees a black hole instead of a
# clean failure it can fail over from.
ExecStart=/usr/bin/autossh -M 0 -N \\
  $SSH_FAMILY \\
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -o ExitOnForwardFailure=yes \\
  -o StrictHostKeyChecking=accept-new \\
  -o UserKnownHostsFile=$HOME_DIR/.ssh/known_hosts \\
  -i $KEY \\
  -p $SSH_PORT \\
  -R $TUNNEL_PORT:127.0.0.1:$PROXY_PORT \\
  $TUNNEL_USER@$SERVER_HOST
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
if [[ "$ENABLE_AT_BOOT" == "1" ]]; then
  systemctl enable orewire-tunnel >/dev/null
  echo "   installed, starts automatically at boot"
else
  systemctl disable orewire-tunnel >/dev/null 2>&1 || true
  echo "   installed, NOT started at boot (ENABLE_AT_BOOT=0)"
fi

cat <<EOF

=========================================================================
 STEP A — in the OreWire admin panel (no server terminal needed):
          Admin -> Proxies -> "Home network tunnel", paste this and Save.
          It takes effect on the next connection; no redeploy.

$PUBKEY

 STEP B — back here, start it:

   sudo systemctl start orewire-tunnel
   systemctl status orewire-tunnel --no-pager

 STEP C — in OreWire Admin -> Proxies -> Add proxy:

   Name          Home network
   Tier          residential
   Host          127.0.0.1         <-- the tunnel ends inside the backend container
   Port          $TUNNEL_PORT
   Username      $PROXY_USER
   Password      $PROXY_PASS
   Sessid        (leave blank)
   Fallback only UNTICKED

 Then edit the Oxylabs row and TICK "Fallback only".

 SAVE THE PASSWORD ABOVE — it is not stored anywhere else in readable form.
=========================================================================
EOF
