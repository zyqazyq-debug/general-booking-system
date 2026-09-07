# R1 immutable release and hot-development contract

Status: repository contract only. It does not authorize or perform NAS, Cloudflare, DNS, container, database, or secret changes.

## Invariants

1. Development hot reload and production release are separate Compose projects, networks, data, secrets, bots, hostnames, and state.
2. Production code and H5 assets come only from image digests named by one `booking.release/v1` manifest.
3. `docker cp`, writable application code, source bind mounts, ignored `dist`, and `latest` tags are invalid production inputs.
4. Cloudflare keeps one stable origin. Application release changes only the internal active blue/green upstream.
5. `/telegram/webhook` is a root route and is never rewritten below `/api`.
6. Only the stable edge runtime port may be published. Backend, PostgreSQL, and Redis remain internal.
7. Liveness, readiness, version identity, migration compatibility, and singleton ownership are distinct gates.
8. An application rollback never automatically reverts a database migration.

## Topology

```text
Cloudflare hostname
  -> stable edge
       -> gateway-blue  -> backend-blue  --+
       -> gateway-green -> backend-green --+-> internal PostgreSQL / Redis
```

The edge owns transport and slot selection only. It must not contain booking-domain behavior.

## Development HMR

`ops/compose/compose.dev.yml` mounts backend/frontend source into separate Node containers and keeps each `node_modules` directory in a named volume. PostgreSQL and Redis use dev-only volumes. Host ports bind to loopback by default.

Watcher polling is opt-in through `BOOKING_DEV_USE_POLLING`; it is intended only for NAS/SMB environments that lose file events. A production Compose file containing CHOKIDAR/WATCHPACK controls fails validation.

R2 must make the Vite proxy target configurable through `VITE_DEV_PROXY_TARGET`; the current application configuration is not yet container-ready.

## Production release

The minimum release unit is:

- backend image digest and SBOM digest;
- gateway image digest, embedded H5 asset digest, route-contract digest, and SBOM digest;
- clean Git SHA;
- config schema and API compatibility versions;
- additive migration floor and rollback-compatible release declaration;
- read-only manifest and gate receipts.

Frontend-only and backend-only production publication are denied by default. A future exception requires an explicit compatibility range and dedicated mixed-version smoke tests.

## State machine

```text
IDLE -> LOCKED -> MANIFEST_VERIFIED -> STAGED
  -> EXPAND_MIGRATED -> CANDIDATE_STARTED -> CANDIDATE_READY
  -> SINGLETON_TRANSFERRED -> SWITCHED -> OBSERVING -> COMMITTED -> IDLE
```

Before switch, failures abort the candidate and leave the active slot unchanged. After switch, failures enter `ROLLBACK_PENDING` and may return to the previous slot only while `contractMigrationApplied=false`. A destructive contract migration moves the release to `AUTOMATIC_ROLLBACK_FORBIDDEN`.

Every transition must compare the expected generation. R2/R3 must combine a NAS process lock with a PostgreSQL advisory lock and persist state through atomic replacement plus an append-only event log.

## Ownership

| Owner | Owns | Must not own |
|---|---|---|
| Booking NAS/Cloudflare | Compose/network contracts, stable edge, release state, NAS evidence | booking business rules, health implementation, migrations |
| Runtime/CI | clean build, image/SBOM/digest production, validators and probes | live Tunnel/DNS/token mutation |
| Backend/runtime | health/version endpoints, secret-file loader, DB compatibility, singleton fence, webhook idempotency | NAS slot switch or Cloudflare configuration |
| Main scheduler | leases and approval for every production mutation | implicit implementation detail changes |

## Fail-closed behavior

Missing files, malformed JSON, mutable image tags, dirty source identity, secret-like manifest fields, wildcard edge defaults, exposed data ports, wrong webhook path, stale deployment generation, timeouts, non-200 probes, and release identity mismatches all produce non-zero results.

R1 tools are read-only. No switch/restart/rollback command exists in this phase.

## Legacy entrypoints

The historical `ops/deploy-prod.ps1` and `tools/ops/deploy-prod.ps1` scripts
previously copied assets and used `docker cp` to overwrite a running backend.
They are parser-safe, local fail-closed stubs and exit `80`; no SSH, NAS,
Docker, or container command remains in either implementation. The historical
stop scripts are also disabled because stopping the entire data and application
stack is not a release or a rollback.

The only future production path is an approved executor for the
`booking.release/v1` contract. R1 intentionally does not implement that
executor.
