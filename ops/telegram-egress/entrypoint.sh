#!/bin/sh
set -eu

# WARP's own listener is intentionally loopback-only.  socat is the only
# process allowed to expose it to the private Compose network.
mkdir -p /run/dbus /var/log/cloudflare-warp
dbus-daemon --system --nofork --nopidfile &
dbus_pid="$!"
warp-svc >/var/log/cloudflare-warp/warp-svc.log 2>&1 &
warp_pid="$!"
socat_pid=""
cleanup() {
  kill "$warp_pid" 2>/dev/null || true
  kill "$dbus_pid" 2>/dev/null || true
  if [ -n "$socat_pid" ]; then kill "$socat_pid" 2>/dev/null || true; fi
  wait "$warp_pid" 2>/dev/null || true
  wait "$dbus_pid" 2>/dev/null || true
  if [ -n "$socat_pid" ]; then wait "$socat_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM

attempt=0
until timeout 5 warp-cli --accept-tos status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  kill -0 "$dbus_pid" 2>/dev/null || exit 1
  kill -0 "$warp_pid" 2>/dev/null || exit 1
  sleep 1
done
if ! timeout 15 warp-cli --accept-tos registration show >/dev/null 2>&1; then
  timeout 30 warp-cli --accept-tos registration new
fi
timeout 15 warp-cli --accept-tos mode proxy
timeout 15 warp-cli --accept-tos proxy port 40000
timeout 30 warp-cli --accept-tos connect

attempt=0
until timeout 5 warp-cli --accept-tos status | grep -Eqi '^[[:space:]]*Status update:[[:space:]]*Connected[[:space:]]*$'; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  kill -0 "$dbus_pid" 2>/dev/null || exit 1
  kill -0 "$warp_pid" 2>/dev/null || exit 1
  sleep 1
done

socat TCP-LISTEN:1080,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:40000 &
socat_pid="$!"
while kill -0 "$dbus_pid" 2>/dev/null && kill -0 "$warp_pid" 2>/dev/null && kill -0 "$socat_pid" 2>/dev/null; do sleep 1; done
exit 1
