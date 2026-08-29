#!/bin/sh
# Start a virtual X display, then hand PID 1 to node.
#
# The relay must run Chrome *headed* — headless Chrome is scored heavily by the
# bot walls this app has to get through, and no amount of JS patching closes that
# gap. On a container with no monitor that means Xvfb.
#
# Why not `xvfb-run node index.js`? xvfb-run is a shell wrapper that does not
# reliably forward SIGTERM to its child, so every Dokploy redeploy would wait out
# the 10s kill timeout. Starting Xvfb ourselves and `exec`-ing node makes node
# PID 1, so stop/restart is immediate and clean.
set -e

DISPLAY_NUM="${XVFB_DISPLAY:-99}"
SCREEN="${XVFB_SCREEN:-1920x1080x24}"

Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN}" -ac -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY=":${DISPLAY_NUM}"

# Wait for the display to accept connections before Chrome tries to use it.
i=0
while [ "$i" -lt 50 ]; do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.1
done

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "[entrypoint] Xvfb failed to start — the relay will fall back to headless and get blocked." >&2
fi

exec "$@"
