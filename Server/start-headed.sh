#!/usr/bin/env bash
#
# Launch the OreWire backend under a virtual X display (Xvfb) so the relay can
# run *headed* Chromium (RELAY_HEADLESS=false) on a server with no monitor.
# Headed Chrome is far harder for bot walls (PerfDrive/ShieldSquare) to detect.
#
# Used by PM2:  pm2 start ./start-headed.sh --name backend --interpreter bash
#
# `xvfb-run -a` picks a free display each launch; `exec` hands the process tree
# to xvfb-run so PM2 tracks the right PID and SIGTERM/cleanup propagate on
# restart (Xvfb is torn down when node exits).
set -e
cd "$(dirname "$0")"
exec xvfb-run -a --server-args="-screen 0 1920x1080x24 -ac -nolisten tcp" node index.js
