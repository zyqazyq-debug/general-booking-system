# Compose ownership boundaries

`compose.preprod.yml` defines both blue and green candidate services. Green
uses loopback port `BOOKING_GREEN_PORT` (fixed preproduction value 18082) and blue uses
`BOOKING_BLUE_PORT` (fixed preproduction value 18083). Port 18081 belongs to an
unrelated service and is never a booking deployment target. Starting an inactive candidate never
changes the Cloudflare route; ingress switching is a separate fenced action.

- `compose.dev.yml`: source bind mounts and watcher/HMR behavior. Dev-only.
- `compose.data.yml`: long-lived PostgreSQL and Redis. No host-published ports.
- `compose.edge.yml`: the single stable runtime ingress.
- `compose.release.yml`: immutable blue/green application slots. No source or asset bind mounts.
- `compose.preprod-telegram-egress.yml`: mandatory preproduction overlay for the
  release-bound WARP egress singleton. It extends both API slots without
  replacing their edge/data networks, and extends both order workers without
  replacing their data network. Telegram clients receive only the internal
  `preprod-telegram` network and `socks5h://telegram-egress:1080`; only the
  egress service joins the uplink network.

These files are executable release contracts, but they are not authorization to
deploy. The application supports `/livez`, `/readyz`, `/__ops/version` and the
declared `*_FILE` secrets. A production render is acceptable only after the
canonical deployment-state lease is held, immutable image and manifest
identities are verified, migrations have a receipt, and the G4 rollback drill
has passed for that exact candidate.

Preproduction database and Telegram mutations have paired readback profiles:
`baseline-ledger`/`baseline-readback`, `migrate`/`migrate-readback`, and
`telegram-webhook-set`/`telegram-webhook-readback`. The webhook setter has no
Compose dependency on `schema-migrate`; the fenced executor proves the ledger
first and invokes both Telegram services with `--no-deps`. These profiles are
only implementation endpoints for the fenced executor and must not be invoked
manually as an alternative deployment path.

For a v2 preproduction release the base and overlay are one immutable Compose
bundle. The manifest binds the digest of both files, and every stage, probe,
singleton, webhook, ingress, and observation action renders and rechecks that
same two-file bundle. First prepare the singleton through the fenced
`preprod-prepare-telegram-egress` action. A healthy container alone is not
evidence: the executor also checks its OCI labels, image ID, runtime isolation,
exact networks, and a fresh operation/container-bound token-free Telegram HTTPS
receipt before any later action can advance.
