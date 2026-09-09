#!/bin/sh
set -eu

[ "$#" -eq 3 ] || exit 20
operation_id="$1"
container_id="$2"
image_id="$3"
case "$operation_id" in *[!A-Za-z0-9._:-]*|'') exit 20 ;; esac
case "$container_id" in *[!0-9a-f]*|'') exit 20 ;; esac
case "$image_id" in sha256:????????????????????????????????????????????????????????????????) ;; *) exit 20 ;; esac

case "${BOOKING_RELEASE_ID:-}" in booking-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-*) ;; *) exit 20 ;; esac
case "${BOOKING_MANIFEST_DIGEST:-}" in sha256:????????????????????????????????????????????????????????????????) ;; *) exit 20 ;; esac
case "${BOOKING_TELEGRAM_EGRESS_DIGEST:-}" in sha256:????????????????????????????????????????????????????????????????) ;; *) exit 20 ;; esac

timeout 5 warp-cli --accept-tos status | grep -Eqi '^[[:space:]]*Status update:[[:space:]]*Connected[[:space:]]*$'
body="$(mktemp /tmp/telegram-egress-readback.XXXXXX)"
trap 'rm -f "$body"' EXIT INT TERM
code="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' --proxy socks5h://127.0.0.1:1080 --connect-timeout 5 --max-time 10 https://api.telegram.org/botinvalid/getMe)"
[ "$code" = 404 ] || exit 30
grep -Eq '^\{"ok":false,"error_code":404,"description":"Not Found"\}[[:space:]]*$' "$body" || exit 30

observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"schema":"booking.telegram-egress-receipt/v1","status":"pass","operationId":"%s","releaseId":"%s","manifestDigest":"%s","egress":{"imageDigest":"%s","network":"booking-preprod-telegram","proxyUrl":"socks5h://telegram-egress:1080"},"container":{"id":"%s","imageId":"%s","composeProject":"booking-preprod","composeService":"telegram-egress"},"transport":{"scheme":"https","target":"api.telegram.org","path":"/botinvalid/getMe","tokenFree":true,"httpStatus":%s},"observedAt":"%s"}\n' \
  "$operation_id" "$BOOKING_RELEASE_ID" "$BOOKING_MANIFEST_DIGEST" "$BOOKING_TELEGRAM_EGRESS_DIGEST" "$container_id" "$image_id" "$code" "$observed_at"
