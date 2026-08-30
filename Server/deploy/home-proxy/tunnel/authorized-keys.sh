#!/bin/sh
# Called by sshd on every authentication attempt (AuthorizedKeysCommand).
#
# Reading the key at auth time rather than baking it in at container start is
# what lets the OreWire admin panel add or rotate the laptop's key with no
# redeploy and no server terminal: the panel writes the file, the next
# connection picks it up.
#
# The restriction prefix is applied HERE, so a key pasted into a web form can
# never accidentally arrive without it.
set -eu

LISTEN_PORT="${TUNNEL_LISTEN_PORT:-8888}"
KEYS_FILE="${TUNNEL_KEYS_FILE:-/keys/authorized_key.pub}"

emit() {
  # permitlisten must name the address explicitly: a bare port only matches a
  # request for "localhost", which is not what the laptop asks for.
  printf 'restrict,port-forwarding,permitlisten="0.0.0.0:%s" %s\n' "$LISTEN_PORT" "$1"
}

# Panel-managed keys (shared volume), then the env fallback for a fully
# declarative deploy.
if [ -r "$KEYS_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    case "$line" in ssh-*|ecdsa-*|sk-*) emit "$line" ;; esac
  done < "$KEYS_FILE"
fi

if [ -n "${TUNNEL_AUTHORIZED_KEY:-}" ]; then
  echo "$TUNNEL_AUTHORIZED_KEY" | while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    case "$line" in ssh-*|ecdsa-*|sk-*) emit "$line" ;; esac
  done
fi
