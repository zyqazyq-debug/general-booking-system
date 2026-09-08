# R2 application and runtime dependencies

R2 cannot start until current owners release the affected application files. This document records interfaces required by the R1 contracts; it does not grant those leases.

## Backend health and identity

Required endpoints:

- `/livez`: process liveness only; returns `status`, `releaseId`, and `slot`.
- `/readyz`: PostgreSQL, Redis, config schema, migration floor, and runtime-role readiness.
- `/__ops/version`: exact `releaseId`, `slot`, `manifestDigest`, config schema, and migration head.

Telegram network availability must not be part of liveness. Responses must not expose hostnames, usernames, tokens, DSNs, or stack traces.

Likely leases: `backend/src/shared/health/**`, `backend/src/config/**`, and application bootstrap wiring. These paths currently have other-owner changes and are outside R1.

## Secret-file loading

The backend must support `*_FILE` inputs for database, Redis, JWT rotation slots, Telegram bot token, and Telegram webhook secret. A value and its `_FILE` form may not both be set. Missing/unreadable files fail production startup.

Secret values must not be copied into release manifests, Compose interpolation output, command arguments, startup summaries, or structured logs.

## Telegram webhook

Production contract:

- route is exactly `/telegram/webhook`, outside `/api`;
- polling-delete mode is unavailable in production;
- ordinary startup never calls setWebhook or deleteWebhook;
- webhook registration/deletion remains an explicit one-shot operator action;
- the Telegram secret header is validated before accepting an update;
- body-size and rate-limit policy is explicit.

R2 requires a persistent `update_id` idempotency ledger. Suggested non-secret contract:

```text
telegram_webhook_updates
  bot_identity_hash
  update_id
  payload_hash
  status: claimed | completed | failed
  fencing_epoch
  claimed_at
  completed_at

UNIQUE (bot_identity_hash, update_id)
```

The ledger must atomically claim an update before executing side effects. A duplicate with the same payload is acknowledged without repeating work; a duplicate `update_id` with a different payload hash is security-significant and fails closed. The bot token itself is never persisted. Crash recovery, stale claims, retry ownership, and fencing must be tested.

Future webhook smoke must use an isolated fixture/test bot and verify duplicate delivery. R1 probes deliberately do not send webhook requests.

## Singleton jobs

Blue and green may coexist, so polling, scheduled jobs, queues, and webhook side effects require a durable lease with a monotonically increasing fencing epoch. Standby defaults to `BOOKING_WORKERS_ENABLED=false`.

Promotion sequence:

1. candidate API becomes ready with workers disabled;
2. current holder stops accepting new side effects and releases its lease;
3. candidate acquires the next fencing epoch;
4. edge switches traffic;
5. old slot remains available for bounded rollback but cannot consume work.

## Database expand-contract

R2 must replace the current nominal migration guards with:

- one variable contract matching application `POSTGRES_*`/secret-file inputs;
- a real migration plan against the target migration table;
- destructive-SQL classification;
- a real backup with checksum and readability checks;
- additive expand migration compatible with active and candidate releases;
- an isolated restore drill.

The repository preflight is deliberately local/isolated only: `tools/migrate` rejects non-loopback hosts and production/NAS target markers. Its default output is a plan receipt. An operator must supply the separate isolated-target acknowledgement before it can invoke `psql`, `pg_dump`, `pg_restore`, or TypeORM; the executable path records a checksum/readability receipt and has no migration-revert operation.

Application rollback does not invoke `migration:revert`. Contract/drop occurs only in a later release after the rollback window closes.

## Images and frontend development

- Backend and gateway images build from clean source using locked dependencies and are pushed/stored by digest.
- Images run as non-root with read-only application filesystems.
- Gateway embeds H5 and its route configuration.
- Vite must consume `VITE_DEV_PROXY_TARGET` for containerized HMR.
- HMR WebSocket settings are dev-only and never enter production manifests.

## Cross-boundary production prerequisites

R3 additionally requires explicit approval for NAS Compose changes, edge port/network changes, removal of current PostgreSQL/Redis host bindings, Cloudflare origin changes, secret permission/rotation changes, DB migration, active-slot switch, rollback, and cleanup of old releases.
