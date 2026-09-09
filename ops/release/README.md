# Immutable release contract

This directory contains read-only R1 validators. It does not stage, switch, restart, or roll back production.

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | pass |
| 10 | manifest/config contract failure |
| 20 | artifact identity failure |
| 30 | readiness failure |
| 40 | database compatibility/backup failure |
| 50 | singleton conflict |
| 60 | route/ingress failure |
| 70 | transition/switch failure |
| 80 | rollback failure or rollback forbidden |

`manage-deploy-state.mjs` is the only state-writing interface. It never accepts
an arbitrary `--state` or root path. Production execution derives its root from
the platform trust boundary (`/var/lib/happybooking/deploy-state` on Linux and
`%ProgramData%/HappyBooking/deploy-state` on Windows), then derives exactly
`<root>/<environment>/<project>/deploy-state.json`. Tests may inject a temporary
root through the library API, but the CLI has no environment-variable escape
hatch. The state binds that
environment/project to its edge network, data network, database reference and
ingress reference. It never calls Docker, NAS, Cloudflare, DNS, a database, or
an HTTP endpoint. Every invocation requires `--execute true`,
`--approval-id`, `--expected-generation`, `--expected-fencing-epoch`, and
`--manifest-digest`. A missing argument, stale generation/epoch, wrong or
expired lease, identity mismatch, missing probe/receipt digest, or existing
filesystem lock fails closed.

The `booking.deploy-state/v2` contract binds complete active, candidate, and
rollback identities (`slot`, release, Git SHA, manifest digest). `acquire`
increments the fencing epoch and snapshots the active identity as the rollback
target. `takeover` is allowed only after lease expiry and increments the epoch
again. Every write increments generation exactly once. Before `SWITCHED`, the
state must contain candidate and rollback probe digests plus the separately
collected switch-receipt digest. Rollback completion requires both the action
receipt and a post-rollback identity probe. Contract migration makes automatic
rollback fail with exit 80.

State writes use a same-directory exclusive `.lock`, a mode-0600 temporary
file, file `fsync`, atomic rename, and directory `fsync`. A leftover lock is
never broken automatically; investigate its owner and the state/edge receipts
before manually removing it. These mechanics serialize the evidence ledger;
they do not perform the external edge switch represented by a receipt.

Supported actions are `init`, `acquire`, `renew`, `takeover`, and `transition`.
The caller cannot provide `--now` or `--expires-at`; acquire, renewal, and
takeover use the process clock plus `--lease-duration-ms`, bounded from 30,000
through 1,800,000 milliseconds. Use immutable `sha256:` evidence digests. Run
`node --test ops/check/deploy-state-cas.test.mjs` for a fully local rehearsal.

Before an operation is cleared to `IDLE`, the store writes and `fsync`s an
immutable terminal receipt under the canonical sibling `receipts` directory.
Each receipt contains the terminal state digest, operation and approval IDs,
fencing epoch, active identity, evidence digests, and the prior receipt digest.
Only after that receipt is durable is its digest installed as the state's new
`receiptChainHead` and the operation state atomically cleared.

## External executor fencing protocol

`execute-fenced-action.mjs` is the mandatory preproduction side-effect entry
point for Docker Compose, database migration, ingress switching, and Telegram
webhook registration. It holds the canonical deployment-state lock across the
external command and its readback. Every affected resource independently
persists a monotonic
`highestAcceptedFencingEpoch` for its exact resource identity. Before a write,
it must atomically compare the command's environment, project, resource ID,
operation ID, manifest digest, lease ID, holder ID, and fencing epoch with both
the ledger and its resource-local epoch. Reject the command when the lease is
expired, any identity differs, or `commandEpoch < highestAcceptedFencingEpoch`.
Persist the new highest epoch before applying the external mutation; never
lower or reset it during rollback.

Every follow-up write, including worker activation, edge reload, migration,
rollback, and cleanup, must carry the same epoch and re-check current lease/CAS
state. The executor may emit a switch or rollback receipt only after reading
the mutated resource back and proving its identity. The receipt must include
the accepted epoch and resource-local epoch; its immutable digest is then
supplied to the state transition. The state writer treats that digest only as a
selector into the canonical immutable executor receipt store: it recomputes the
receipt digest and verifies its action, operation/approval, generation/epoch,
lease/holder, manifest/release identity, request digest, resource set, and every
resource chain head before changing phase. A caller-provided hash or a JSON
receipt without this resource-side enforcement is evidence formatting, not
fencing. See
`FENCED_EXECUTOR_RUNBOOK.md` for the phase/action matrix and Synology boundary.

## Local immutable-artifact gate

`generate-sbom.mjs`, `generate-provenance.mjs`, and `generate-manifest.mjs` are local-only: they do not build or push images, and all refuse a dirty Git worktree. Generate artifact files outside the repository (otherwise their untracked files intentionally make the gate fail). The manifest binds the checked-out Git SHA, immutable backend/gateway image digests, both SBOM and SLSA-style provenance document digests, an H5 directory digest, `pages.json` route-contract digest, migration catalog digest, and the fixed probe paths.

Use an immutable image repository (no tag, digest supplied separately); placeholder registries and mutable tags are rejected. `validate-artifacts.mjs` recomputes every local binding from the same inputs and rejects drift. A passing local gate is evidence of reproducible inputs only; it is not an image push, registry attestation, deployment, or live probe.

## Database migration and Telegram cutover order

The release image carries the exact TypeScript migration sources at
`/app/migration-source`. The migration runner recomputes the same ordered
source catalog digest used by the immutable manifest. Execution requires the
target environment and database, catalog digest and floor, an exact ordered
JSON allowlist of pending TypeORM class names, and a verified backup receipt
file plus the SHA-256 digest of that receipt. The receipt follows
`ops/contracts/database-backup-receipt.schema.json`, binds the same release,
Git SHA, manifest, database and migration catalog, confirms `pg_restore
--list`, and must be no more than one hour old.
Candidate receipts use the canonical-JSON manifest digest. The one observed
legacy old-green release is explicitly marked `raw-bytes`, because its deployed
identity predates the canonical digest convention; no candidate may use that
mode.

Before `runMigrations`, the runner reads the target `migrations` ledger. A
missing ledger, unknown applied name, pending-name/order mismatch, source
catalog drift, or destructive pending `up()` operation fails closed. The
runner never invokes `migration:revert`.

The fenced webhook action first runs the independent migration-ledger readback
while holding the database and data-network resource locks. It then starts the
`telegram-webhook-set` one-shot container with `docker compose run --no-deps`.
This is required: webhook registration must not implicitly start or reuse a
migration service. The one-shot setter then probes the environment's exact
public `/readyz` URL and matches release ID, full Git SHA, manifest digest,
config schema, migration catalog digest and migration floor before it calls
Telegram `getMe`. `/readyz` compares the configured floor to the database's
actual migration-ledger head. Therefore the enforced order is:

```text
verified bound backup -> exact-plan migration -> database-backed readyz ->
release identity match -> getMe identity match -> setWebhook -> read-back
```

Do not run the compiled setter or Compose profile directly. Only the fenced
executor may perform the ledger readback followed by the exact `--no-deps`
setter and independent webhook readback.
