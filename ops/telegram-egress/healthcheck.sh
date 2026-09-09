#!/bin/sh
set -eu

timeout 5 warp-cli --accept-tos status | grep -Eqi '^[[:space:]]*Status update:[[:space:]]*Connected[[:space:]]*$'
# A real Telegram host probe without a bot token.  It must use the WARP
# listener.  The fixed invalid Bot API route has a deterministic Telegram JSON
# 404 response, so an arbitrary proxy-generated 4xx cannot pass.
body="$(mktemp /tmp/telegram-egress-health.XXXXXX)"
trap 'rm -f "$body"' EXIT INT TERM
code="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' --proxy socks5h://127.0.0.1:1080 --connect-timeout 5 --max-time 10 https://api.telegram.org/botinvalid/getMe)"
[ "$code" = 404 ]
grep -Eq '^\{"ok":false,"error_code":404,"description":"Not Found"\}[[:space:]]*$' "$body"
