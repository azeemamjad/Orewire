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
TUNNEL_USER="${TUNNEL_USER:-tunnel}"        # the user inside the tunnel container
SSH_PORT="${SSH_PORT:-2222}"                # published port of the tunnel container
TUNNEL_PORT="${TUNNEL_PORT:-8888}"          # bound inside that container
PROXY_PORT="${PROXY_PORT:-3128}"
PROXY_USER="${PROXY_USER:-orewire}"
ENABLE_AT_BOOT="${ENABLE_AT_BOOT:-1}"
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
PROXY_PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
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
code_auth="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  -x "http://$PROXY_USER:$PROXY_PASS@127.0.0.1:$PROXY_PORT" https://www.sedarplus.ca/home/ || echo 000)"
code_noauth="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  -x "http://127.0.0.1:$PROXY_PORT" https://www.sedarplus.ca/home/ || echo 000)"
code_denied="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  -x "http://$PROXY_USER:$PROXY_PASS@127.0.0.1:$PROXY_PORT" https://example.com/ || echo 000)"
echo "   sedarplus.ca with credentials : $code_auth   (want 200)"
echo "   sedarplus.ca without creds    : $code_noauth   (want 407)"
echo "   example.com  with credentials : $code_denied   (want 403)"
[[ "$code_auth" == "200" ]] || die "proxy cannot reach SEDAR+ — check the allowlist"
[[ "$code_noauth" == "407" ]] || die "proxy served a request WITHOUT credentials — do not continue"
[[ "$code_denied" == "403" ]] || die "proxy reached a non-allowlisted host — do not continue"
echo "   all three gates behave correctly"

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
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -o ExitOnForwardFailure=yes \\
  -o StrictHostKeyChecking=accept-new \\
  -o UserKnownHostsFile=$HOME_DIR/.ssh/known_hosts \\
  -i $KEY \\
  -p $SSH_PORT \\
  -R 0.0.0.0:$TUNNEL_PORT:127.0.0.1:$PROXY_PORT \\
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
   Host          tunnel            <-- the container's service name, not an IP
   Port          $TUNNEL_PORT
   Username      $PROXY_USER
   Password      $PROXY_PASS
   Sessid        (leave blank)
   Fallback only UNTICKED

 Then edit the Oxylabs row and TICK "Fallback only".

 SAVE THE PASSWORD ABOVE — it is not stored anywhere else in readable form.
=========================================================================
EOF
