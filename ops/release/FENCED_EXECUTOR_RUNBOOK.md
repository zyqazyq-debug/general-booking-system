# Fenced external executor runbook

## Scope and trust boundary

`execute-fenced-action.mjs` is the only supported entry point for a
preproduction external mutation. `manage-deploy-state.mjs` is the only state
ledger writer. The NAS host has no Node runtime, so both must be invoked through
the reviewed `run-booking-preprod-control-plane` launcher; direct ad-hoc
containers are not an alternative entry point. The scripts accept no command string, executable,
working directory, state path, state root, release path, or caller-supplied
clock. Commands are constructed as executable plus argument arrays and are
spawned with `shell: false`.

The application release remains pinned to the manifest's Node 20 runtime. That
runtime is independent from the control plane. The control-plane launcher uses
the already verified, digest-pinned
`node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`
(Node 22 bookworm-slim) with `--pull never`; it must never be used as evidence
that an application image satisfies its Node 20 manifest contract.

Install the launcher root-owned and non-group/non-other-writable at
`/usr/local/libexec/happybooking/run-booking-preprod-control-plane`. Install the
reviewed `ops/release` control-plane tree below the fixed root-owned
`/usr/local/libexec/happybooking/control-plane/ops/release`. The launcher accepts
only the symbolic entrypoints `manage-deploy-state`, `execute-fenced-action`,
`generate-database-backup-receipt`, and
`generate-schema-diff-receipt`; it maps them internally to fixed scripts, validates an
exact option allowlist and a shell-inert value alphabet, rejects duplicate
options, and requires `--environment preprod`, `--project booking-preprod` and
`--execute true` before Docker is called.

Its Docker plan is fixed to host networking, UID/GID 0, a read-only root
filesystem, all capabilities dropped, `no-new-privileges`, a bounded `/tmp`,
and only these host mounts:

- `/var/lib/happybooking` read-write;
- `/volume1/homes/realzyq/booking-preprod` read-only;
- `/var/run/docker.sock` read-write;
- `/var/packages/ContainerManager/target/usr/bin/docker` read-only at the same path;
- `/var/packages/ContainerManager/target/usr/bin/docker-compose` read-only at
  `/root/.docker/cli-plugins/docker-compose`;
- `/usr/local/libexec/happybooking/control-plane` read-only;
- the self-contained `switch-preprod-ingress` launcher and
  `switch-preprod-ingress.mjs` files read-only at their same absolute paths;
- only `/etc/happybooking/secrets/cloudflare-preprod-api-token` read-only at
  its same absolute path.
- `/volume1/homes/realzyq/booking-preprod/.g4/backups` read-write only for the
  backup generator;
- `/volume1/homes/realzyq/booking-preprod/.g4/receipts` read-write only for the
  backup and schema-diff generators.

The last three mounts are action-scoped: the two ingress-helper files and the
Cloudflare token file are added only for
`execute-fenced-action:preprod-switch-ingress` and
`execute-fenced-action:preprod-rollback-ingress`. State initialization, lease
management, baseline, migration, staging and Telegram webhook actions neither
mount nor preflight the Cloudflare token, so an intentionally absent token
cannot block those earlier gates.
The evidence generators never receive arbitrary paths. Their symbolic inputs
are an inert operation ID and, for candidate binding, a strictly parsed release
ID plus exact backup digest. The launcher constructs the manifest, backup, and
receipt paths below the fixed preproduction roots. Backup creation is fixed to
the observed legacy release and `identity=old`; binding is fixed to a distinct
candidate and `identity=candidate`; schema-diff is fixed to the legacy release,
old identity, and green slot. The outer preproduction root remains read-only,
with only the two nested evidence directories over-mounted read-write.

Because access to the Docker socket is equivalent to Docker-daemon authority,
the container flags alone are not a host security boundary. The primary
controls are the two-entrypoint allowlist, root-owned immutable control-plane
sources, fixed paths and image digest, and the fenced scripts' own argument and
state contracts. The launcher also resets `PATH`, `HOME`, `NODE_OPTIONS`,
`NODE_PATH`, `LD_PRELOAD`, `DOCKER_HOST` and `DOCKER_CONFIG` after reading the
root-only env file so that it cannot redirect the Node runtime or Docker daemon.

The Debian image is deliberate: the tested Synology Compose v2.20.1 plugin is a
glibc binary and does not execute in the Alpine control image. The fixed
root-only `/etc/happybooking/secrets/booking-preprod-control-plane.env` supplies
the curated release environment. Host Docker reads this `--env-file`; it is not
mounted into the control container. Never substitute the user-owned project
`.env` as the control container's environment file. The application containers
may still consume their separately mounted runtime env file through Compose.

The fixed container name `booking-preprod-control-plane` is also a fail-closed
concurrency signal. A residual container makes the next `docker run` fail with
a name conflict. The launcher never removes or replaces that container; collect
its state and resolve it through the forensic recovery procedure.

On Synology the executor derives:

- canonical state: `/var/lib/happybooking/deploy-state/preprod/booking-preprod/deploy-state.json`;
- immutable release: `/volume1/homes/realzyq/booking-preprod/releases/<state releaseId>`;
- Compose file: `<release>/ops/compose/compose.preprod.yml`;
- release manifest: `<release>/release-manifest.json`;
- Docker executable: `/var/packages/ContainerManager/target/usr/bin/docker`,
  falling back to `/usr/bin/docker`.

Create the canonical state root once as a root-owned mode-0700 directory. Run
the executor as the same dedicated deployment identity. Do not grant the web
application write access to the state, resource epoch, receipt, release, or
Docker socket paths.

## Mandatory binding

Every call repeats these values from the current canonical state:

- environment and project;
- approval ID and operation ID;
- expected generation and fencing epoch;
- candidate or active manifest digest, according to the action phase;
- lease ID and holder ID;
- the action's canonical primary resource ID;
- a unique, stable action ID.

The executor holds the canonical `.lock` for the complete preflight, mutation,
readback, and receipt write. It also takes resource-local locks in sorted order,
then atomically stores the highest accepted epoch and a pending-action marker
before mutation. A pre-existing state lock, resource lock, or pending marker is
never removed automatically, even if it appears stale.

## Phase/action matrix

| Action | Allowed phase | Canonical resource | Effect and readback |
|---|---|---|---|
| `preprod-baseline-ledger` | `STAGED` | `database:booking-preprod` | One-time only: verifies old release evidence, zero schema diff and a recent backup, atomically creates the ledger, then uses a separate read-only container to prove the exact committed ledger. |
| `preprod-expand-migrate` | `STAGED` | `database:booking-preprod` | Verifies the apply receipt and then independently reopens PostgreSQL to prove the complete ordered migration ledger and its exact release/catalog binding. |
| `preprod-stage` | `STAGED` or `EXPAND_MIGRATED` | `booking-preprod-edge` | Starts only `backend-<candidate slot>` and `gateway-<candidate slot>`; then proves both are running and healthy. |
| `preprod-transfer-singletons` | `CANDIDATE_READY` | `booking-preprod-edge` | Locks edge, data, database, and Telegram identities; stops and proves the old order worker absent before starting exactly one candidate worker, then verifies image, flags, health, and zero host ports. |
| `preprod-switch-ingress` | `SINGLETON_TRANSFERRED` | `ingress:booking-preprod` | Calls the separately installed root-owned ingress helper; then verifies release and manifest identity. |
| `preprod-set-webhook` | `SWITCHED` or `OBSERVING` | `telegram:booking-preprod` | First proves the exact migration ledger, then runs the setter with Compose dependencies disabled and finally performs an independent Telegram `getMe`/`getWebhookInfo` readback. |
| `preprod-rollback-ingress` | `ROLLBACK_PENDING` | `ingress:booking-preprod` | Uses the same pinned helper to restore the immutable `state.rollback` gateway and independently reads the tunnel configuration back. |
| `preprod-rollback-singletons` | `ROLLBACK_PENDING` | `booking-preprod-edge` | Locks the same four singleton resources, stops the failed active worker, and restores the immutable rollback worker. A legacy rollback release without a worker service is accepted only after proving that no worker remains. |

Both API slot services permanently set `BOOKING_WORKERS_ENABLED=false` and
`ORDER_OUTBOX_DISPATCH_ENABLED=false`. `order-worker-blue` and
`order-worker-green` use the same manifest-bound backend image, set both flags
to `true`, publish no host port, join only the data network, and force Telegram
delivery off (`polling` mode with delete-on-startup false, webhook false). Thus
the worker process cannot expose `/telegram/webhook` through either gateway.
The Telegram persistence encryption key is not stored in the shared `.env`.
Preproduction binds only the fixed root-owned
`/volume1/homes/realzyq/booking-preprod/.g4/secrets/telegram-data-encryption-secret`
file into `backend-blue`, `backend-green`, `order-worker-blue`, and
`order-worker-green`, and supplies only
`TELEGRAM_DATA_ENCRYPTION_SECRET_FILE=/run/secrets/telegram_data_encryption_secret`.
No schema, webhook utility, gateway, database, or cache service receives that
mount. The control container needs no key in its env; its existing read-only
preproduction-root mount merely lets Compose validate the fixed host source.
Production likewise removes this key from the common backend anchor and grants
it explicitly only to the two API slots. Runtime validation requires the key
for actual Telegram delivery (webhook or worker activity), not merely because a
utility process can read the bot token.
The webhook secret is likewise absent from the shared `.env` and is mounted
only into `telegram-webhook-set`, `telegram-webhook-readback`, and the two API
slots from the fixed sibling file `.g4/secrets/telegram-webhook-secret`.
Both preproduction secret files are owned by UID 0, use the otherwise-unused
container runtime GID 1000 with mode `0440`, live below a UID-0/GID-0 mode
`0700` directory, and are bind-mounted read-only. This keeps them unreadable to
NAS login users while allowing the non-root backend runtime to read the mounted
file. Verify both readability and non-writability from the exact candidate
runtime image before staging.
The executor rejects two live workers, a live target before the first mutation,
a source that remains live after stop, image or environment drift, missing API
slots, unhealthy target state, and any host port binding. Receipt replay invokes
only the helper's `--readback true` path and never repeats stop or start.

The first green-to-blue transfer has one deliberately narrow legacy exception:
the observed green API may omit `ORDER_OUTBOX_DISPATCH_ENABLED` because that
release predates the outbox. The exception is accepted only when the source is
green and its release ID, full Git SHA, raw manifest digest and running image ID
all equal `LEGACY_OLD_BINDING` in `ops/release/lib/legacy-preprod.mjs`, while
`BOOKING_WORKERS_ENABLED` is exactly false. The blue API must still expose both
flags as false. The readback records `legacySourceNoOutbox=true`; no other
missing flag, slot, release, image, or later deployment is generalized.
The inverse rollback readback records `legacyTargetNoOutbox=true`. Executor
image preflight applies the same one-time binding and requires the observed old
image to have no RepoDigest, exactly one `uniqueTag`, and absent OCI labels;
ordinary candidates and every non-exact legacy identity still require the full
OCI label contract. Ingress rollback does not run a Docker image preflight.

The state transition `CANDIDATE_READY -> SINGLETON_TRANSFERRED` requires both
the rollback identity probe digest and the fenced singleton-transfer receipt
digest. `ROLLED_BACK` symmetrically requires the ingress rollback receipt, the
singleton rollback receipt, and the post-rollback probe digest. Merely changing
the phase cannot satisfy either transition.

These receipt digest arguments are selectors, not caller assertions. Before
changing phase, `manage-deploy-state.mjs` locates the selected immutable action
or recovery receipt below the canonical sibling `executor` store, recomputes
its canonical digest, resolves a recovery to its original action receipt, and
requires every affected resource state to name that accepted receipt as its
completed chain head. It then binds action, operation, approval, generation,
fencing epoch, lease, holder, manifest, complete release identity, canonical
resource set, and request digest to the locked deploy state. An arbitrary valid
`sha256:` value, a receipt copied from another action or operation, or a receipt
whose resource completion was not durably recorded cannot advance singleton,
switch, or rollback state.

`EXPAND_MIGRATED` records only the additive/expand migration in the phase; it
does not set `contractMigrationApplied`. Therefore a rehearsed rollback remains
reachable after this release's expand-only migration. A separately proven real
contract migration must set `contractMigrationApplied=true`, and the state
machine continues to reject `ROLLBACK_PENDING` in that case.

The current live preproduction slot is green. Therefore the acquired state must
declare blue as the candidate. `preprod-stage` derives `backend-blue` and
`gateway-blue` from that state and binds the latter only to
`127.0.0.1:${BOOKING_BLUE_PORT:-18082}`. It does not recreate green and does
not alter the Cloudflare Tunnel. The inverse applies on a later blue-to-green
release. A missing slot service fails in the read-only Compose preflight before
any epoch is accepted or container is changed.

`preprod-switch-ingress` and `preprod-rollback-ingress` intentionally fail closed unless the audited,
root-owned `/usr/local/libexec/happybooking/switch-preprod-ingress` helper is
installed. The executor resolves symlinks and requires a regular file owned by
UID 0 with neither group nor other write bits. Record and approve the helper's
SHA-256 during installation; replace it only through the release change
procedure. That helper is the Cloudflare/NAS-specific trust boundary.

The mutation invocation is exactly:

```text
switch-preprod-ingress
  --project booking-preprod
  --hostname booking-preprod.happybooking.uk
  --upstream gateway-<candidate slot>:8080
  --release <candidate releaseId>
  --manifest-digest <candidate manifestDigest>
  --operation-id <current operationId>
  --fencing-epoch <current fencingEpoch>
```

The independent readback invocation is exactly:

```text
switch-preprod-ingress --readback --project booking-preprod
  --hostname booking-preprod.happybooking.uk
```

Rollback uses the same shapes but binds `--release`, `--manifest-digest`, and
`gateway-<slot>:8080` to immutable `state.rollback`, never to caller input. The
legacy rollback manifest may retain its historical raw-file SHA-256 only when
that exact file, release ID, Git SHA, and image identity match; new candidate
manifests remain canonical-JSON digest only.

Readback must emit one JSON object with exactly `schema`, `project`, `hostname`,
`upstream`, `releaseId`, `manifestDigest`, `operationId`, `fencingEpoch`, and
`observedAt`. `schema` is `booking.ingress-readback/v1`; every identity must
match the mutation command and `observedAt` must be a valid timestamp. The
helper must use a root-readable token file, pin the one preproduction account
and tunnel ID internally, preserve unrelated ingress rules byte-for-byte,
perform the strongest documented version/digest-guarded update, and read the remote tunnel
configuration back. It must reject a production hostname, tunnel, project,
container, database, or route.

The reviewed helper sources are the extensionless launcher
`ops/release/switch-preprod-ingress` and standalone Node implementation
`ops/release/switch-preprod-ingress.mjs`. Install them at
`/usr/local/libexec/happybooking/switch-preprod-ingress` and
`/usr/local/libexec/happybooking/switch-preprod-ingress.mjs`. Both must be
root-owned and non-group/non-other-writable; record and approve both SHA-256
digests. The implementation also verifies its own ownership and mode before
reading credentials or making a request. The launcher keeps the executor's
fixed extensionless path while preserving explicit ESM parsing on Node 20.
Its only credential
source is the fixed root-only file
`/etc/happybooking/secrets/cloudflare-preprod-api-token`; the token is never an
argument, environment binding, proof field, or diagnostic value. Create
`/var/lib/happybooking/ingress` as a root-owned mode-0700 directory before the
first call. The helper stores its current secret-free fenced proof there and
combines that proof with a new remote GET for every independent readback.

The helper is compiled to account `a29dfe7707f6e6cec070a6fafd7c90d3`, tunnel
`008210c0-6e25-4726-8976-03b6d77d39e2`, project `booking-preprod`, hostname
`booking-preprod.happybooking.uk`, and the two services
`http://gateway-green:8080` / `http://gateway-blue:8080`. It refuses an absent
or duplicate target rule, an existing target outside those services, or a
production hostname inside this dedicated tunnel. The PUT body is the complete
GET configuration with only the target rule's `service` value changed; the
global `originRequest`, target metadata, unrelated ingress rules, rule order,
and other configuration fields must remain JSON-value identical.

Cloudflare's documented configuration endpoint exposes a response `version`,
but its PUT contract documents neither a version request field nor `If-Match`
or another atomic compare-and-swap precondition. Consequently this helper must
not be described as providing remote atomic CAS. It holds a local fail-closed
lock, performs two matching GETs (version plus canonical configuration digest),
opportunistically sends `If-Match` when Cloudflare returns an ETag, performs the
full replacement PUT, and requires a third GET to match the PUT response's
version and complete configuration. This detects drift before and after the
write, but a remote writer can still race in the undocumented interval between
the second GET and PUT. Restrict the API token and Cloudflare dashboard write
access to the release operator, and treat an unexpected audit-log writer as a
G4 blocker.

API contract reference:
<https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/>

No production action exists in this executor. Any production environment,
project, resource, or action name is rejected before path resolution or command
execution. Production remains fail-closed until a separately reviewed executor
and resource map are implemented after G4 acceptance.

`preprod-baseline-ledger` exists solely for the observed legacy
`booking_preprod` database whose old release reports zero schema-builder up and
down operations but has no TypeORM ledger. The historical prefix must end at
`1788720000000-HardenPaymentSettlementIdentity`; its recomputed digest must be
`sha256:0e7a7e34490864497391ae86953920b2ea20926ae1aba79fcea151e7c2fbab24`.
The complete class-name/timestamp list, old release and manifest identities, a
schema-diff receipt with `upCount=0` and `downCount=0`, and a verified database
backup receipt plus the backup object's `backupDigest` are all exact,
digest-bound inputs. Both observation receipts
must be no more than one hour old. An existing ledger or any production marker
is rejected before creation.

After the baseline, the normal runner permits only the approved 178873–178876
tail. Each has a PostgreSQL catalog preflight covering every touched table,
column, index and named constraint. A pre-existing touched object or a future
migration without an explicit shape contract is rejected before TypeORM runs;
this prevents `IF NOT EXISTS` from silently accepting schema drift.

The baseline, migration and webhook actions never treat their mutation stdout
as current external state. Each has a distinct readback service and receipt
schema. Migration readback binds database, release ID, full Git SHA, manifest,
catalog, floor, backup receipt, complete ledger head and ledger digest. Baseline
readback binds the old release evidence and the digest of the exact ordered
history. Webhook readback does not call `setWebhook`; it checks public readiness,
`getMe`, and `getWebhookInfo`. The setter and its readback are invoked with
`docker compose run --no-deps`, so the webhook action cannot implicitly launch
`schema-migrate`; its separately fenced preflight uses only
`schema-migration-readback`.

## Image and static-asset identity

Build backend and gateway images with the exact `BOOKING_GIT_SHA` and
`BOOKING_RELEASE_ID` build arguments. Both final images must carry
`org.opencontainers.image.revision`, `uk.happybooking.release-id`, and the
component label. Generate `release-manifest.json` only after those final images
exist. When a registry `RepoDigest` exists, the manifest image digest must be
that exact repository digest. For a NAS-local image with no `RepoDigest`, the
manifest digest must be the exact Docker image ID observed after the build.

Before candidate start the executor verifies the release tag, RepoDigest or
local image ID, and OCI labels directly through Docker. After start it repeats
the image inspection, rejects tag drift, obtains each Compose container ID,
and proves the running container's `.Image` equals that same manifest-bound
image ID. It then copies `/usr/share/nginx/html` read-only from the running
gateway into an executor-owned temporary directory, applies the same sorted
path/file digest algorithm used by manifest generation, and requires equality
with `manifest.artifacts.gateway.frontendAssetDigest`. Temporary evidence is
removed after hashing. `/readyz` and `/__ops/version` remain useful runtime
checks but cannot replace Docker and static-asset identity.

The database and Telegram one-shot services use deterministic container names.
After both the mutation receipt and independent readback are valid, the executor
inspects each retained container and requires its `.Image` to equal the same
manifest-bound backend image ID, then removes those containers by exact name.
On receipt replay the mutation container is never recreated: only the named
readback container is run, inspected and removed. A name collision, missing
container, tag drift, wrong Image ID, wrong OCI labels, or cleanup failure leaves
the action pending and fails closed for forensic recovery.

## Invocation shape

Use values read immediately from the canonical state; do not copy values from
an older terminal or receipt. This is a shape example, not runnable values:

```text
node ops/release/execute-fenced-action.mjs
  --action preprod-stage
  --execute true
  --environment preprod
  --project booking-preprod
  --approval-id <current approvalId>
  --expected-generation <current generation>
  --expected-fencing-epoch <current fencingEpoch>
  --manifest-digest <current candidate manifestDigest>
  --operation-id <current operationId>
  --lease-id <current leaseId>
  --holder-id <current holderId>
  --resource-id booking-preprod-edge
  --action-id <stable unique action ID>
```

Supply Compose configuration and secrets only through the root-owned runtime
environment. Never place a token, password, webhook secret, or runtime env-file
content in CLI arguments or receipts. The executor records only digests of
stdout/readback and a bounded non-secret verification summary.

## Recovery

On command failure the executor writes an immutable failure receipt but leaves
the resource pending marker in place. On process interruption the exclusive
lock file also remains. Both conditions are intentional. Stop and collect:

1. canonical deploy state and its digest;
2. resource fencing state and pending action;
3. immutable executor receipt, if present;
4. Docker, database, ingress, or Telegram readback performed independently;
5. process identity and audit logs.

Only a human forensic recovery procedure may clear an exact lock or pending
marker after deciding whether the external action happened. Never reset or
decrease `highestAcceptedFencingEpoch`, including during rollback.

If a process crashes after the pass receipt is durable but before every
resource pending marker is cleared, replaying the same action ID does not trust
the old receipt. The executor reacquires all resource locks, verifies the old
receipt digest and each resource's pending/completed identity, performs a fresh
external readback (including Docker image/container/H5 checks for stage), then
writes `booking.external-action-recovery/v1`. Only that recovery digest is
installed as every resource's new chain head while pending markers are cleared.
A fully completed replay also performs fresh readback; drift rejects the replay.
Actions without an independent readback cannot be replayed and fail closed.

Run the local non-mutating suite with:

```text
node --test ops/check/deploy-state-cas.test.mjs ops/check/fenced-executor.test.mjs ops/check/preprod-singletons.test.mjs ops/check/preprod-control-plane-launcher.test.mjs ops/check/preprod-evidence-generators.test.mjs
```

## Preproduction backup and zero-diff evidence

Run both generators only from the fixed, ephemeral control container. The
container must mount the NAS Docker socket, the immutable release root, and the
fixed booking-preprod evidence roots at their canonical absolute paths. The
CLI offers no state-root, container, database, network, or environment-file
override. Never pass a password on the command line.

Create one custom-format backup and bind its receipt to the explicitly scoped
legacy old manifest:

```text
run-booking-preprod-control-plane generate-database-backup-receipt
  --action create --execute true --identity old
  --environment preprod --project booking-preprod
  --release-id booking-20260908T202714Z-317be4dec675
  --operation-id <operation>
```

The generator reads `current_database()` and `current_user` from the fixed
`booking-preprod-postgres-1` container, requires both to be
`booking_preprod`, streams `pg_dump --format=custom` without a shell, hashes
the backup object, and streams it back through `pg_restore --list`. It creates
the backup and receipt with mode 0600; receipt publication uses a same-directory
fsynced temporary file plus an exclusive hard link, so it cannot overwrite an
existing receipt. Backup files are never deleted.

To bind that same immutable backup to the candidate manifest, use a distinct
receipt path and the first receipt's exact `backupDigest`:

```text
run-booking-preprod-control-plane generate-database-backup-receipt
  --action bind-existing --execute true --identity candidate
  --environment preprod --project booking-preprod
  --release-id <candidate-release> --operation-id <operation>
  --expected-backup-digest sha256:<exact-backup-digest>
```

Generate the old-release zero schema-diff receipt before baseline creation:

```text
run-booking-preprod-control-plane generate-schema-diff-receipt
  --action generate --execute true
  --environment preprod --project booking-preprod
  --operation-id <operation>
```

This command accepts only the one observed legacy old-green identity:
`booking-20260908T202714Z-317be4dec675`, its fixed full Git SHA, raw manifest
file digest, catalog/floor, image ID, and sole legacy tag. This is an explicit
one-time compatibility binding because that image predates OCI release labels
and its manifest repository differs from its only local tag. The receipt states
`legacyManifestDigestMode=raw-bytes` and includes `legacyImageBinding`; this
exception is unavailable to a candidate or future release. The generator also
proves that exactly one running Compose `backend-green` container in
`booking-preprod` uses that same image ID and tag. It starts a named read-only
one-shot container on `booking-preprod-data` and runs TypeORM's schema-builder
log against the fixed `booking_preprod` target. The structured output must
report the actual database/user and empty `upQueries` and `downQueries`. The
generator then verifies the retained container `.Image`, repeats image inspect
to reject tag drift, removes that exact one-shot container, and writes the
root-only receipt containing the image ID, declared image digest, schema-log
digest and zero counts. A name collision, nonzero diff, wrong database/user,
image mismatch, unexpected OCI labels or extra RepoTags, tag drift, cleanup failure, existing receipt, symlinked input,
or path outside the fixed roots fails closed.

The legacy manifest originally lives under the operation artifact root. Before
either old-identity generator runs, materialize it read-only at the canonical
release path shown above without reformatting or reserializing it; its exact raw
bytes must continue to hash to
`sha256:0a597f6f3825f670d8a64dc6e19eec98b684e418994403257e0dd5502d983743`.
