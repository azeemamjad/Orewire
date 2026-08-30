#!/bin/sh
#
# Builds the authorized_keys line itself rather than trusting the operator to
# remember the restriction prefix — forgetting it is the difference between a
# key that can open one port and a key that can do anything.
set -eu

LISTEN_PORT="${TUNNEL_LISTEN_PORT:-8888}"
KEYFILE=/etc/ssh/authorized_keys.d/tunnel

# Persistent host key: without this the laptop sees a changed host key on every
# container restart and (correctly) refuses to connect.
if [ ! -f /etc/ssh/keys/ssh_host_ed25519_key ]; then
  echo "[tunnel] generating host key"
  ssh-keygen -t ed25519 -N '' -f /etc/ssh/keys/ssh_host_ed25519_key >/dev/null
fi
chmod 600 /etc/ssh/keys/ssh_host_ed25519_key

# Keys are resolved per connection by authorized-keys.sh, from the shared volume
# the admin panel writes to (or TUNNEL_AUTHORIZED_KEY as a fallback). Warn, but
# do not refuse to start: the container coming up first and the key being added
# from the panel afterwards is the normal order of operations.
KEYS_FILE="${TUNNEL_KEYS_FILE:-/keys/authorized_key.pub}"
if [ -s "$KEYS_FILE" ]; then
  echo "[tunnel] key file present: $KEYS_FILE"
elif [ -n "${TUNNEL_AUTHORIZED_KEY:-}" ]; then
  echo "[tunnel] using TUNNEL_AUTHORIZED_KEY from the environment"
else
  echo "[tunnel] no key yet — add the laptop's public key in Admin -> Proxies"
fi
echo "[tunnel] listen 0.0.0.0:${TUNNEL_LISTEN_PORT:-8888}"

exec /usr/sbin/sshd -D -e
