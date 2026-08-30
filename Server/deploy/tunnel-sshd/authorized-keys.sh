#!/bin/sh
# sshd calls this on every authentication attempt, so a key added in the admin
# panel takes effect immediately — no restart, no redeploy, no server shell.
set -eu
LISTEN_PORT="${TUNNEL_LISTEN_PORT:-8888}"
KEYS_FILE="${TUNNEL_KEYS_FILE:-/app/data/tunnel/authorized_key.pub}"

[ -r "$KEYS_FILE" ] || exit 0
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  case "$line" in
    ssh-*|ecdsa-*|sk-*)
      # permitlisten pins the forward to this one port. The client asks for a
      # bare port, which ssh sends as the hostname "localhost".
      printf 'restrict,port-forwarding,permitlisten="localhost:%s" %s\n' "$LISTEN_PORT" "$line"
      ;;
  esac
done < "$KEYS_FILE"
