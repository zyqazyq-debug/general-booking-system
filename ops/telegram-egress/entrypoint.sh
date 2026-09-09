#!/bin/sh
set -eu

# WARP's own listener is intentionally loopback-only.  socat is the only
# process allowed to expose it to the private Compose network.
dbus-daemon --system --fork --nopidfile
warp-svc >/var/log/cloudflare-warp/warp-svc.log 2>&1 &

until warp-cli status >/dev/null 2>&1; do sleep 1; done
if ! warp-cli registration show >/dev/null 2>&1; then
  warp-cli registration new
fi
warp-cli mode proxy
warp-cli connect

exec socat TCP-LISTEN:1080,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:40000
