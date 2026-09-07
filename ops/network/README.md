# Network contract

`edge/nginx.conf.template` is the versioned, non-secret stable ingress contract.
The mutable NAS edge state supplies only `/etc/nginx/upstreams/active.conf`.

Rules:

- Cloudflare keeps one stable origin; application releases never update DNS or Tunnel routing.
- `/telegram/webhook` is an explicit root route. It must never be rewritten to `/api/telegram/webhook`.
- Only the edge runtime port may be published. Backend, PostgreSQL, and Redis stay on internal networks.
- `BOOKING_TRUSTED_PROXY_CIDR` must identify the actual cloudflared network. A wildcard or arbitrary LAN CIDR is rejected by release validation.
- Slot changes require a generated candidate file, `nginx -t`, atomic replacement, reload, and post-switch identity probes.
- The examples are fixtures for generation and tests; they are not live NAS state.
