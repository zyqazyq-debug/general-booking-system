#!/bin/sh
set -eu

warp-cli status | grep -qi 'connected'
# A real Telegram host probe without a bot token.  It must use the WARP
# listener, and a 4xx response is the expected anonymous Bot API outcome.
code="$(curl --silent --output /dev/null --write-out '%{http_code}' --proxy socks5h://127.0.0.1:1080 --connect-timeout 5 --max-time 10 https://api.telegram.org/botinvalid/getMe)"
case "$code" in 4??) exit 0 ;; *) exit 1 ;; esac
