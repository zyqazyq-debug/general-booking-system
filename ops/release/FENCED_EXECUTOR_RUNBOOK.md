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

### Atomic control-plane installation

Do not update either the launcher or the control-plane tree in place. The
installer is a separate, reviewed root entrypoint and accepts no path,
environment, project, or production selector. Prepare a root-owned,
non-group/non-other-writable bundle at the only accepted source location:

```text
/volume1/happybooking/booking-preprod/.g4/control-plane-install/bundles/
  <booking-control-YYYYMMDDTHHMMSSZ-12hex>/
    bundle-declaration.json
    installer.mjs
    source-archive.tar
    payload/
      run-booking-preprod-control-plane
      switch-preprod-ingress
      switch-preprod-ingress.mjs
      control-plane/ops/release/...
```

The payload root has exactly those four entries. It contains no symlink,
device, socket, FIFO, or `node_modules` directory. `bundle-declaration.json`
has an exact schema and binds the full 40-lowercase-hex Git SHA, approval ID,
source-archive digest, reviewed installer digest, payload inventory digest,
tracked-file allowlist and its digest. The install ID's 12-hex suffix must equal
the first 12 characters of the full Git SHA. The installer hashes its own
running bytes and the bundled installer, requires both to equal the declaration,
requires the allowlist to equal every payload file, and rejects a relative ESM
import outside that closure. The root-owned executable `installer.mjs` must be
the exact reviewed bytes being run. The installer re-hashes both itself and that
bundle copy, and also re-hashes the immutable non-executable
`source-archive.tar`; all three values must equal the declaration. Extra bundle
root entries are rejected. The archive is not an opaque evidence string: it
must be produced in a clean checkout by the declaration's exact token vector
`git archive --format=tar --prefix=source/ <full-sha> -- <sorted-source-files>`.
The declaration records that vector and its digest plus an exact mapping from
each installed payload path to its repository source path and a mapping digest.
The restricted POSIX tar must contain the Git archive global PAX
`comment=<full-40-hex-commit>`, only regular files and directories, exactly the
mapped source-file set, and bytes, sizes and executable modes that reproduce
every payload file. Links, devices, duplicate/traversing paths, local PAX
overrides, a different commit comment, an extra source file, or a mapping drift
fail closed.

The PAX comment is not by itself proof that Git created the archive. Before NAS
transfer, run `build-booking-preprod-control-plane-bundle.mjs` only from the
clean checkout whose exact `HEAD` is the supplied full SHA. The builder has a
source-code-fixed allowlist and source-to-payload mapping (including both the
runtime and installer launchers), reads payload and installer bytes from Git
objects rather than the worktree, invokes `git archive` with the recorded
argument vector and no shell, strips every inherited `GIT_*` variable, forces
`GIT_NO_REPLACE_OBJECTS=1`, rejects any `git replace -l` result, and refuses
missing, extra, dirty or non-HEAD sources. It also makes a no-local/no-hardlink
clone, regenerates the archive there, compares the full raw archive and every
source object, then asks the installer itself to validate the completed
declaration and inventory. It publishes under the workspace-local
`.g4/control-plane-bundle-build/bundles/<install-id>` and emits a non-secret
`approval-tuples/<install-id>.json`. That tuple deliberately says
`awaiting-independent-approval`; it is reproducible build input, not an
approval or signature. The approver must independently resolve the committed
SHA, re-execute the recorded vector without shell interpolation, hash the raw
archive, compare the tuple of full Git SHA, archive-command digest, raw archive
digest, payload-map digest, payload inventory, installer digest and declaration
digest, and then create the separately signed approval evidence required by G4.
The tuple explicitly binds the bootstrap installer-launcher digest as well as
the installed runtime launcher. Transfer the tuple to the fixed per-install
approval directory. Before approval, run `active-inventory`: it inventories
only `/usr/local/libexec/happybooking` with strict root-owned, non-symlinked
`0555` directory/executable and `0444` non-executable modes, hashes the fixed
`/etc/machine-id` without disclosing it, and returns canonical entries, digest
and observation time. Its container has only the bundle, active tree and
machine-id as read-only mounts; it has no Docker socket, state/receipt write
mount, host PID namespace, or network. It accepts no caller path or digest.

The independent approver creates a canonical
`booking.preprod.control-plane-approval-receipt/v2` binding the tuple, exact
install/Git/approval identity, approver identity, anchored approver-key digest,
`hostIdentityDigest`, `expectedActiveInventoryDigest`, and
`activeInventoryObservedAt`, then signs the receipt bytes with Cosign.
Provision the dedicated public key and its digest anchor root-owned at
`/etc/happybooking/trust/control-plane-approver.pub{,.sha256}`. The private key
must remain off NAS. Until a real second-party key, signature and anchor are
provisioned, control-plane installation remains NO-GO.

```text
node ops/release/build-booking-preprod-control-plane-bundle.mjs \
  --git-sha <exact-clean-HEAD-40hex> \
  --install-id <booking-control-YYYYMMDDTHHMMSSZ-12hex> \
  --approval-id <proposed-approval-id>
```

The NAS has no host Node runtime. Install root-owned mode `0555`
`run-booking-preprod-control-plane-installer` at the fixed
`/usr/local/libexec/run-booking-preprod-control-plane-installer` path and invoke only that shell
launcher. It starts the fixed `booking-preprod-control-plane-installer`
container from the digest-pinned Node image with `--network none`, `--pid host`,
read-only container root, all capabilities dropped, `no-new-privileges`, and
only the fixed bundle, receipt, deploy-state, Docker and `/usr/local/libexec`
mounts. The bundle's reviewed `installer.mjs` is the Node entrypoint. Run
inventory with all identity arguments:

This host bootstrap is itself part of the signed boundary. Before every Docker
call or dry-run output, it requires its resolved invocation path to equal
the fixed path, verifies that it and every parent through `/usr/local/libexec`
are root-owned, non-symlinked and not group/other writable, and hashes its own
bytes. That digest must equal `bootstrapInstallerLauncherDigest` in the
self-digested approval tuple. Except for the isolated pre-approval
`active-inventory` action described above, it then recomputes the signed approver receipt,
requires the receipt to bind the same tuple/install/Git/approval identity,
validates the dedicated public key against its root-owned digest anchor, and
runs host Cosign `verify-blob`. It addresses `sha256sum`, `stat`, and `readlink`
through fixed `/bin` paths, checks their root-owned trusted directory in the
real path, and admits only the architecture-specific reviewed Cosign 3.1.2
binary digest. The bundle and approval chains are checked through the fixed
`/volume1/happybooking/booking-preprod/.g4` trust root, and the approver-key
chain through the fixed `/etc/happybooking` trust root; every directory and
consumed child in those chains must be root-owned, non-symlinked and not
group/other writable. The Cosign binary receives the same checks through
`/usr/local/bin`.
Changing the bootstrap `IMAGE`, executing a copied or symlinked launcher,
widening a launcher/parent/mount-root mode, replacing the tuple, or substituting
the signature therefore stops before Docker. The bootstrap test-root facility
is accepted only together with dry-run and cannot launch a container.

```text
run-booking-preprod-control-plane-installer --action inventory \
  --install-id <install-id> --git-sha <40-hex> --approval-id <approval-id>
```

Before creating the signed approval receipt, obtain its legacy-active binding:

```text
run-booking-preprod-control-plane-installer --action active-inventory \
  --install-id <install-id> --git-sha <40-hex> --approval-id <approval-id>
```

Preserve the canonical declaration and payload inventory digests as approval
inputs. Install supplies those exact bundle digests; the active-tree digest is
derived only from the independently signed v2 approval receipt:

```text
run-booking-preprod-control-plane-installer --action install \
  --install-id <install-id> --git-sha <40-hex> --approval-id <approval-id> \
  --source-archive-digest sha256:<64hex> \
  --installer-digest sha256:<64hex> \
  --bundle-declaration-digest sha256:<64hex> \
  --tracked-allowlist-digest sha256:<64hex> \
  --expected-inventory-digest sha256:<64hex> \
  --approval-tuple-digest sha256:<64hex> \
  --approver-receipt-digest sha256:<64hex>
```

The installer independently reads the tuple, approval receipt and detached
signature from
`.../.g4/control-plane-install/approvals/<install-id>/`, recomputes both
self-digests, checks every bundle and identity binding, verifies the distinct
root-owned public-key anchor, verifies the pinned Cosign binary, and runs
offline `cosign verify-blob`. An approval ID or active-tree hash supplied by a
caller is not approval evidence; install does not accept a caller active hash.
Immediately before rename it repeats the strict inventory and requires equality
with the signed expected digest. Missing, forged, cross-tuple, wrong-host,
changed-active, or wrong-key evidence stops before any active-tree rename.

Before and again after creating its fixed install lock, every action requires an expired
deploy lease, no deploy-state lock, no resource lock below
`executor/resources`, and proof that the fixed
`booking-preprod-control-plane` container is not running. The ordinary control
launcher atomically holds
`/usr/local/libexec/.happybooking-control-plane-runtime.lock` for the complete
Docker foreground run and refuses the install lock; the installer checks that
runtime lock again immediately before switching. This closes the supported
launcher race, while direct ad-hoc Docker execution remains prohibited. Install,
rollback and recovery reject active, rollback, transaction trees, or any nested
tree path that is a mountpoint or on a different device from
`/usr/local/libexec`.

After a durable `PREPARED` journal, installation copies into a version-named
staging directory beside `/usr/local/libexec/happybooking`, normalizes directories
to root-owned `0555`, executable files to `0555`, and other files to `0444`, then
recomputes the complete inventory to detect a source/copy race. Before switching,
it runs syntax checks, imports the complete `.mjs` closure, and performs the
fixed launcher dry-run. Same-filesystem directory renames retain the immediately
previous active tree as the single
`/usr/local/libexec/happybooking.rollback`. File data and metadata, journal and
receipt temporaries, rename parents, receipt publication, and cleanup parents
are fsynced. Receipt publication uses an exclusive same-directory hard link and
never overwrites an existing receipt.

The fixed root-owned journal
`/usr/local/libexec/.happybooking-control-plane-install.journal.json` progresses
through `PREPARED`, `OLD_RETIRED`, `ACTIVE_MOVED`, `NEW_ACTIVE`,
`RECEIPT_PUBLISHED`, and `COMPLETE`. A process failure after `PREPARED` does not
synchronously restore anything: the lock and journal deliberately remain. All
ordinary actions must then stop. Invoke only `--action recover` with the exact
install ID, full Git SHA, approval ID, and journal transaction ID. Recovery
reads the immutable journal, inventories every possible tree, and either
finishes an already published receipt state or restores the exact pre-operation
active and rollback inventories. A durable journal temporary left by a crash at
any later phase is accepted only when all immutable transaction fields match;
recovery then removes that exact temporary before writing `COMPLETE`. If
recovery itself is interrupted, repeat the same recovery request. The install
lock is not exposed as an empty directory: the installer creates a
transaction-named temporary lock directory, durably writes and fsyncs its owner
record and directory, and atomically renames the complete directory to the one
fixed lock name. Only recovery may remove a stale install lock. Its immutable
owner record binds the fixed Docker container name and full ID, host PID
namespace PID, host boot ID and `/proc` start ticks. Recovery runs as the
distinct fixed `booking-preprod-control-plane-installer-recovery` container, so
a stopped normal `booking-preprod-control-plane-installer` owner may retain its
name for forensics without preventing recovery from starting; recovery never
removes or renames that old container. It resolves the recorded owner by both
full ID and fixed name and requires both Docker reads to describe the same
object and running state. Recovery refuses a still-running/restarted owner, a
replacement under the fixed name, or an unavailable/inconsistent Docker
daemon. A lock without a published journal is cleared only when that owner is
dead and no transaction tree exists. Immediately before removing any fixed or
temporary lock artifact, recovery repeats its inventory/digest/owner readback,
repeats the Docker name/full-ID/liveness proof, and re-verifies its own recovery
container identity; any change freezes the artifact. A crash
or ENOSPC before atomic publication can leave only the exact transaction-named
temporary directory. Recovery accepts no ambiguous temporary, requires the
fixed installer-container identity and no journal or transaction tree,
publishes an exclusive immutable forensic receipt binding the observed artifact
inventory, and only then removes it. The same atomic publication is used when a
valid journal exists but its lock must be reconstructed; another crash requires
repeating the same recovery request. Empty or malformed fixed locks are never an
ordinary cleanup path and receive the same fail-closed forensic treatment. A
forensic receipt for an artifact without a valid owner records
`identityUnknown=true`, a null owner digest, and labels the supplied identifiers
only as the recovery request; it does not attribute those identifiers to the
unknown prior lock creator. A
candidate inventory equal to active is rejected before `PREPARED` and the same
no-op equality in a journal is never recovered by moving a tree.
Any unknown inventory, identity, path, receipt, or temporary-file state is a
forensic stop, not permission to delete it.

The immutable install receipt is written atomically below the only accepted
evidence root:

```text
/volume1/happybooking/booking-preprod/.g4/receipts/
  control-plane-install-<install-id>.json
```

After install, use `--action readback --install-id <install-id>
--expected-receipt-digest sha256:<64hex>`. Readback opens the immutable receipt,
recomputes its self-digest, validates its exact identity fields, independently
inventories the active tree, and returns receipt-derived identity rather than
caller-echoed Git or approval values. Do not begin lease takeover until this
passes. `--action rollback` requires expected active and rollback inventory
digests and requires `--rollback-id` to equal the install ID being undone. The
immutable install receipt must still prove both the current installed inventory
and its recorded rollback inventory; that receipt digest is bound into the
rollback journal and receipt. It then swaps only the two fixed trees and
publishes a separate exclusive immutable receipt.

Its Docker plan is fixed to host networking, UID/GID 0, a read-only root
filesystem, all capabilities dropped, `no-new-privileges`, a bounded `/tmp`,
and only these host mounts:

- `/var/lib/happybooking` read-write;
- `/volume1/happybooking/booking-preprod` read-only;
- `/var/run/docker.sock` read-write;
- `/var/packages/ContainerManager/target/usr/bin/docker` read-only at the same path;
- `/var/packages/ContainerManager/target/usr/bin/docker-compose` read-only at
  `/root/.docker/cli-plugins/docker-compose`;
- `/usr/local/libexec/happybooking/control-plane` read-only;
- `/usr/local/bin/cosign` read-only;
- `/etc/happybooking/trust/cosign-preprod.pub` and
  `/etc/happybooking/trust/cosign-preprod.pub.sha256` read-only;
- `/etc/happybooking/secrets/booking-preprod-control-plane.env` read-only;
- the self-contained `switch-preprod-ingress` launcher and
  `switch-preprod-ingress.mjs` files read-only at their same absolute paths;
- `/volume1/happybooking/booking-preprod/.g4/backups` read-write only for the
  backup generator;
- `/volume1/happybooking/booking-preprod/.g4/receipts` read-write only for the
  backup and schema-diff generators.

The tested Synology Docker daemon reports no usable PID or CPU cgroup
controller for these one-shot control containers. Therefore the launcher does
not pass `--pids-limit` or `--cpus`; those options can fail container creation
before the fenced program runs. This narrow compatibility exception does not
relax the controls that are available and enforced: `--read-only`, `--user
0:0`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, the bounded
no-exec `/tmp`, fixed image digest, `--pull never`, fixed mounts, and the
argument allowlist. Re-run the launcher plan test and a no-mutation container
startup smoke after any Synology Container Manager upgrade before reconsidering
controller flags.

The ingress mounts are action-scoped: the two ingress-helper files are added only for
`execute-fenced-action:preprod-switch-ingress` and
`execute-fenced-action:preprod-rollback-ingress`. State initialization, lease
management, baseline, migration, staging and Telegram webhook actions do not
mount them. No action mounts or preflights a Cloudflare API token: ingress
cutover is a local Docker-network operation.
The two nested evidence write mounts are added only to the corresponding
backup/schema-diff generator. The evidence generators never receive arbitrary paths. Their symbolic inputs
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
the curated release environment. Host Docker reads it for the outer
`docker run --env-file`; the same file is also mounted read-only so the fenced
process can pass its fixed path to the inner `docker compose --env-file`.
Never substitute the project `.env` as the control container's environment
file. Application containers consume their separately mounted runtime env file
through Compose.

The fixed container name `booking-preprod-control-plane` is also a fail-closed
concurrency signal. A residual container makes the next `docker run` fail with
a name conflict. The launcher never removes or replaces that container; collect
its state and resolve it through the forensic recovery procedure.

On Synology the executor derives:

- canonical state: `/var/lib/happybooking/deploy-state/preprod/booking-preprod/deploy-state.json`;
- immutable release: `/volume1/happybooking/booking-preprod/releases/<state releaseId>`;
- Compose file: `<release>/ops/compose/compose.preprod.yml`;
- Telegram egress overlay: `<release>/ops/compose/compose.preprod-telegram-egress.yml`;
- release manifest: `<release>/release-manifest.json`;
- Docker executable: `/var/packages/ContainerManager/target/usr/bin/docker`,
  falling back to `/usr/bin/docker`.

Create the canonical state root once as a root-owned mode-0700 directory. Run
the executor as the same dedicated deployment identity. Do not grant the web
application write access to the state, resource epoch, receipt, release, or
Docker socket paths.

Candidate manifests use `booking.release/v2` and must bind the canonical digest
of the base Compose file plus Telegram egress overlay at
`artifacts.deployment.composeDigest`. Before a Compose-backed action,
the executor resolves the fixed release path, rejects a release-local `.env`,
requires the release directory, manifest and Compose file to be root-owned and
non-group/non-other-writable, and recomputes that digest. It mounts and supplies the fixed
root-only `/etc/happybooking/secrets/booking-preprod-control-plane.env` through explicit
`docker compose --env-file`; implicit project environment is never trusted.
Only the exact historical old-green v1 raw manifest may use the fixed,
digest-bound `legacy-preprod-rollback.compose.yml` exception.

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
| `preprod-abort-telegram-egress` | fixed incident `FAILED` recovery only | `telegram:booking-preprod` | Stops and independently proves the failed candidate egress absent, then closes or freshly re-attests the exact historical Telegram resource chain without contacting production Telegram. |
| `preprod-attest-database-restore` | fixed incident `FAILED` recovery only | `database:booking-preprod` plus data network | Performs no restore mutation. It proves the already restored legacy database OID, empty migration ledger, fixed forensic backup/evidence digests, and data-network binding. |
| `preprod-restore-active-runtime` | fixed incident `FAILED` recovery only | edge, data, database, Telegram, and ingress resources | Starts only the two fixed stopped legacy green container IDs with `docker start`; it cannot pull, create, Compose-up, or replace them. It then proves container/image/config/network/security identity, legacy database identity, local and public release endpoints, and empty preprod webhook state. |
| `preprod-probe-recovered-active` | fixed incident `FAILED` recovery only | `probe:booking-preprod:active` | Runs a fresh public probe of the exact recovered legacy green identity. Its receipt is independently required for `FAILED_RECOVERED`. |
| `preprod-baseline-ledger` | `STAGED` | `database:booking-preprod` | One-time only: verifies old release evidence, zero schema diff and a recent backup, atomically creates the ledger, then uses a separate read-only container to prove the exact committed ledger. |
| `preprod-expand-migrate` | `STAGED` | `database:booking-preprod` | Verifies the apply receipt and then independently reopens PostgreSQL to prove the complete ordered migration ledger and its exact release/catalog binding. |
| `preprod-prepare-telegram-egress` | `EXPAND_MIGRATED` or controlled `ROLLED_BACK` re-promotion | `telegram:booking-preprod` | Renders the bound two-file Compose bundle, starts only `telegram-egress`, and proves image, labels, isolation, exact networks, health, and a fresh token-free Telegram HTTPS receipt bound to this operation and container. |
| `preprod-stage` | `EXPAND_MIGRATED` or controlled `ROLLED_BACK` re-promotion | `booking-preprod-edge` | Starts only `backend-<candidate slot>` and `gateway-<candidate slot>`; then proves both are running and healthy. |
| `preprod-probe-candidate` | `CANDIDATE_STARTED` | `probe:booking-preprod:candidate` | Proves the isolated candidate release identity. |
| `preprod-probe-active` | `CANDIDATE_READY` | `probe:booking-preprod:active` | Freshly proves the old active identity before singleton transfer. |
| `preprod-probe-observation` | `OBSERVING` | `probe:booking-preprod:observation` | Runs the v2 business smoke twice (execution plus independent readback): public root UI, exact health/version identity, register/login/refresh/logout, both `/r/:code` and `/s/:slug` redirects, explicit Login Widget domain/embed evidence, synthetic Telegram Login signature/session/database evidence, isolated PostgreSQL cleanup, and two deliveries of one no-message Telegram `update_id` ending in one processed inbox row and zero recorded outbound operations. |
| `preprod-probe-rollback` | `ROLLBACK_PENDING` | `probe:booking-preprod:rollback` | Fresh post-rollback probe required before `ROLLED_BACK`. |
| `preprod-transfer-singletons` | `CANDIDATE_READY` | `booking-preprod-edge` | Locks edge, data, database, and Telegram identities; stops and proves the old order worker absent before starting exactly one candidate worker, then verifies image, flags, health, and zero host ports. |
| `preprod-switch-ingress` | `SINGLETON_TRANSFERRED` | `ingress:booking-preprod` plus `booking-preprod-edge` | Calls the separately installed root-owned ingress helper to transfer the logical `gateway-green` alias from the exact source gateway to the exact candidate gateway, restarts the exact hardened tunnel container, and independently reads back topology and identity. |
| `preprod-set-webhook` | `SWITCHED` or `OBSERVING` | `telegram:booking-preprod` | First proves the exact migration ledger, then runs the setter with Compose dependencies disabled and finally performs an independent Telegram `getMe`/`getWebhookInfo` readback. The setter fixes `allowed_updates` to `message,callback_query`; the receipt preserves before/after delivery-error metadata and only a newly appearing or changed post-set error blocks the action. |
| `preprod-rollback-ingress` | `ROLLBACK_PENDING` | `ingress:booking-preprod` plus `booking-preprod-edge` | Uses the same pinned helper to restore the logical alias to immutable `state.rollback`, restarts the exact hardened tunnel container, and independently reads back topology and identity. |
| `preprod-rollback-singletons` | `ROLLBACK_PENDING` | `booking-preprod-edge` | Locks the same four singleton resources, stops the failed active worker, and restores the immutable rollback worker. A legacy rollback release without a worker service is accepted only after proving that no worker remains. |

Both API slot services permanently set `BOOKING_WORKERS_ENABLED=false` and
`ORDER_OUTBOX_DISPATCH_ENABLED=false`. `order-worker-blue` and
`order-worker-green` use the same manifest-bound backend image, set both flags
to `true`, publish no host port, retain the data network and additionally join
only the internal Telegram egress network, and force Telegram
delivery off (`polling` mode with delete-on-startup false, webhook false). Thus
the worker process cannot expose `/telegram/webhook` through either gateway.
The Telegram persistence encryption key is not stored in the shared `.env`.
Preproduction binds only the fixed root-owned
`/volume1/happybooking/booking-preprod/.g4/secrets/telegram-data-encryption-secret`
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

The same exact legacy binding has a narrow public-cache exception. Historical
green responses may omit `Cache-Control: no-store`; no candidate or other
release may do so. Even for exact legacy, the probe fixes the HTTPS origin and
path, attaches a fresh random cache-busting nonce, sends `Cache-Control:
no-cache, no-store` and `Pragma: no-cache`, requires `Age` to be absent or zero,
and rejects Cloudflare `HIT`, `STALE`, `REVALIDATED`, or `UPDATING`. The legacy
exception is therefore not permission to accept a stale cached 200 response.

The `OBSERVING` probe has no legacy or production mode. It fixes every request
to `https://booking-preprod.happybooking.uk`, uses TLS certificate validation,
sets `Cache-Control: no-cache, no-store, max-age=0` and `Pragma: no-cache`, and
rejects unexpected redirects and cached Cloudflare states. The two intended
short-link responses must be 302 with exact relative `Location` values; every
other request rejects redirects. The test user is deterministic per
operation/action/generation/fence and is owned by the conjunction of its
`g4_<digest>` username and the same marker at `smoke.invalid`. Pre-cleanup,
database readback, and deletion all require both values. A colliding username
with any other email is a hard stop and is never deleted. The user and its
cascaded session rows are deleted and read back as absent before the receipt is
published. If the process is interrupted, rerun only the same fenced action;
its ownership check may clean only that exact fixture.

The webhook payload contains only the deterministic high-range `update_id`, so
it cannot address a chat or carry message content. The same payload is posted
twice. PostgreSQL must then show exactly one `processed` inbox row, a non-null
processing timestamp, and zero rows in `telegram_webhook_operations`. The inbox
row is retained as the durable idempotency proof; it follows the database's
normal evidence-retention policy and must not be manually removed during the
release. The webhook proof is read only from the fixed preproduction file
`.g4/secrets/telegram-webhook-secret`. That file must resolve canonically to a
regular file owned by UID 0, mode 0400 or 0440; group ownership is deliberately
not fixed because the non-root backend needs group-read. Any owner/group write,
execute bit, other permission, non-root owner, or symlink fails closed. The
proof, generated password, session values, authorization header, and cookies
are never emitted in stdout, stderr, receipts, or database queries.

Every non-legacy executor invocation also validates three root-controlled
registry-attestation evidence sets (`backend`, `gateway`, and
`telegram-egress`) under `.g4/supply-chain/<releaseId>/<component>/`. Each set
contains the canonical normalized SBOM, canonical local provenance, and its
immutable receipt. The executor derives these paths from the finalized release
ID; receipt digests do not enter the release manifest, so there is no circular
manifest/receipt identity.

Receipt parsing is only the first check. The fixed `/usr/local/bin/cosign`
3.1.2 binary performs a new signature and two-attestation pull-back for all
three images before planning, after the resource locks are held, immediately
before a mutation, and after readback before a pass receipt is published. Live
subjects, annotations, predicates and verification digests must equal both the
manifest/evidence and the immutable receipt. The only insecure transport flag
remains `--allow-insecure-registry` for exact authority
`127.0.0.1:15001`; verification remains offline-key mode with no ambient
`COSIGN_*` redirect settings.

The approved signer digest comes only from the independently provisioned,
root-owned `/etc/happybooking/trust/cosign-preprod.pub.sha256` anchor and must
match the bytes of `cosign-preprod.pub`. Three receipts carrying the same
unapproved value are rejected. The gate result includes the current operation
ID and fencing epoch and is included in the fenced command identity. Missing
local evidence, missing registry objects, altered trust files, stale operation
or fence identity, or any pull-back drift fails closed before the action can
advance.

Every external milestone is selected from the canonical executor receipt store:
expand requires baseline (for the exact legacy bootstrap) plus migration;
candidate start requires stage; candidate ready requires candidate probe;
singleton transfer requires old-active probe plus singleton; switched requires
ingress; observing requires webhook; committed requires the observation probe;
rolled back requires rollback ingress, rollback singleton and rollback probe.
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

The G4 rollback rehearsal stays within the same unexpired lease. After the
three rollback receipts produce `ROLLED_BACK`, a fresh stage receipt is the only
way to take the controlled `ROLLED_BACK -> CANDIDATE_STARTED` edge. That edge
retains baseline/expand evidence and immutable `rollback=old,candidate=new`, but
clears prior stage, probe, singleton, switch, webhook, observation and rollback
cycle evidence. Candidate probe, old-active probe, singleton, ingress, webhook
and observation receipts must then all be generated again. The one-time
baseline and already-applied expand migrations are not rerun; the rehearsal is
complete only with the new candidate active in `COMMITTED`.

## Fixed op06 recovery and subsequent op07 order

This is an incident-specific continuation plan, not a reusable escape from
`FAILED`. It applies only while the canonical state and immutable forensic
bindings still equal the hard-coded op06 recovery contract:

- phase `FAILED`, generation `11`, fencing epoch `2`, operation
  `g4.fc79097c5756.06`, and an expired lease;
- failed candidate manifest
  `sha256:dc23534a1d05706e073ffa4f0baf78cf069f90fa893d1c6d68559c4f970c3884`;
- exact active/rollback legacy green release
  `booking-20260908T202714Z-317be4dec675` with its preserved raw manifest;
- restored legacy database OID `17915`, no migration rows, disabled quarantine
  database, and stopped fixed legacy backend/gateway containers;
- no production route, container, database, Redis, storage, or Telegram
  resource in any action's resource set.

If any item differs, stop without takeover. Preserve the state file, resource
files, receipts, locks, stopped containers, database quarantine, and forensic
directory. Never edit state JSON, delete a pending marker, or generalize
`FAILED_RESTORE_BINDING` to make a mismatch pass.

### Recover op06 to IDLE

1. Freeze and test the exact repository revision, install it using the atomic
   procedure above, and pass installer readback. Verify that no control-plane
   container, deploy-state lock, or resource lock exists. Verify the immutable
   legacy release, fixed stopped container IDs/configuration, database OID and
   migration absence, and a fresh production non-impact baseline.
2. Take over the expired op06 lease with expected generation `11`, expected
   fence `2`, the same operation ID and failed-candidate manifest, a new
   approval/lease/holder, and the maximum bounded lease of 30 minutes. Read the
   stored state back; expect generation `12`, fence `3`, still `FAILED`.
3. Using only that latest state, execute `preprod-abort-telegram-egress`
   against the failed candidate manifest.
4. Execute `preprod-attest-database-restore` against the failed candidate
   manifest. This attests the completed restore; it does not authorize another
   database restore or swap.
5. Execute `preprod-restore-active-runtime` against the exact legacy active raw
   manifest. It may use only `docker start` for the fixed containers; it must
   not Compose-up, pull, create, replace, change ingress, or modify the database.
6. Execute `preprod-probe-recovered-active` against the exact legacy active raw
   manifest and require the cache-safe legacy probe described above.
7. Transition `FAILED -> FAILED_RECOVERED`, selecting the Telegram abort,
   database attestation, active runtime restore, and recovered-active probe
   receipt digests. The state manager also binds the prior FAILED-state digest.
   The transition invocation remains bound to the operation's failed candidate
   manifest even though the two active actions prove the legacy identity.
8. Re-read generation and transition `FAILED_RECOVERED -> IDLE`. Verify the
   terminal receipt and chain head, `pendingAction=null` on every touched
   resource, fence `3`, active identity equal to legacy green, cleared candidate
   and rollback, healthy public legacy identity, and unchanged production.

After any lease renewal, action, or transition, discard the prior generation
and re-read canonical state. Renewal keeps the same fence, lease ID, and holder
but increments generation. Never reuse a command assembled from an older read.
If any op06 step fails, remain in `FAILED`; do not delete locks or pending
markers and do not proceed to `IDLE`. Wait for expiry and use only an
action-specific, independently read-back takeover recovery. The recovered-active
probe has tested current-fence and prior-fence recovery for missing, fail, and
pass receipts, but every recovery still requires the exact preserved pending
identity and a fresh read-only public fetch. Any action, request, manifest,
command, or predecessor-chain drift is a hard manual forensic stop.

### Build and freeze the new candidate outside a lease

Do not reuse the op06 candidate or any of its images or release directories.
From a clean tracked worktree, excluding every `.codex-tmp-*` artifact, build
fresh linux/amd64 backend, gateway, and Telegram-egress images. Resolve immutable
registry digests and OCI labels; generate normalized SBOM, local provenance,
frontend, route, Compose-bundle and migration-catalog digests; generate the
canonical v2 manifest; and verify all three signatures and two attestations per
image against the independently anchored public key. Install the candidate in
a new root-owned immutable release directory without an `.env`; retain exact
legacy and keep the root-only runtime env separate. Failure here discards only
the incomplete new namespace and never acquires a deploy lease.

### Execute fresh op07 G4

1. From verified `IDLE`/fence `3`, acquire a new op07 with the new candidate in
   inactive blue and a 30-minute lease. Re-read the new fence and generation;
   never assume them in advance.
2. Transition through `MANIFEST_VERIFIED` and `STAGED`. Create an operation-bound
   custom-format backup of the old database, bind the same digest to candidate,
   generate exact legacy zero-schema-diff evidence, execute baseline ledger and
   expand migration, then enter `EXPAND_MIGRATED` with both fenced receipts.
3. Prepare isolated Telegram egress, stage only backend-blue/gateway-blue,
   enter `CANDIDATE_STARTED`, probe inactive candidate, and enter
   `CANDIDATE_READY`.
4. Freshly probe legacy green through public ingress, transfer singleton old to
   candidate, enter `SINGLETON_TRANSFERRED`, switch only dedicated preprod
   ingress to blue, enter `SWITCHED`, set/read back the preprod webhook, then
   enter `OBSERVING`.
5. Keep the same lease and fence alive for the declared observation window.
   Execute `preprod-probe-observation` only after the window is due. Accept only
   `booking.preprod-business-smoke/v2`: it covers public root UI, API
   health/version, register/login/refresh/logout, exact `/r` and `/s` redirects,
   the owned user write/readback and confirmed cleanup, plus two deliveries of
   the same no-message Telegram update ending in one processed inbox row and no
   outbound-operation record. An immediate observation probe alone does not
   prove that the configured time window elapsed.

   The deploy-state v3 contract records both `observationWindowMinutes` and
   `observationStartedAt`. Supply `--observation-window-minutes 30` on `init`
   and every new `acquire` (and on the one-time v2 terminal/recovery migration).
   `OBSERVING` roots the trusted start time. An emergency rollback remains
   available immediately, but it sets `rollbackRehearsalCompleted=false` when
   the window has not elapsed; `COMMITTED` is always rejected until the second
   full observation window has elapsed.
6. Enter `ROLLBACK_PENDING`, switch preprod ingress back to legacy green,
   return singleton to legacy, freshly probe rollback identity, and enter
   `ROLLED_BACK` with all three receipts. Verify candidate worker absent, legacy
   compatible with the additive migration, and production unchanged.
7. Re-promote the same immutable candidate only through fresh receipts: stage to
   `CANDIDATE_STARTED`; candidate probe to `CANDIDATE_READY`; legacy-active probe
   and singleton to `SINGLETON_TRANSFERRED`; ingress switch to `SWITCHED`;
   webhook to `OBSERVING`; then a second bounded observation window and fresh
   observation probe.
8. Enter `COMMITTED` only after the full post-switch rollback set
   `rollbackRehearsalCompleted=true` and business evidence is accepted. Verify
   candidate ingress, exact identity, exactly one worker, webhook, database and
   production isolation; finally enter `IDLE` and verify terminal receipt chain.

Build, SBOM, signature, attestation, archive, and immutable release installation
all occur before acquiring op07. During execution, renew whenever remaining
lease cannot cover mutation, readback, and receipt publication. Singleton
transfer is the last stop where old ingress is unchanged. After ingress switch,
webhook or observation failure goes to fenced rollback. Rollback failure remains
in `ROLLBACK_PENDING`; never bypass it through direct Compose, Cloudflare,
Telegram, or state-file edits.

The current live preproduction slot is green. Therefore the acquired state must
declare blue as the candidate. `preprod-stage` derives `backend-blue` and
`gateway-blue` from that state and binds the latter only to
`127.0.0.1:18083`. The trusted environment must bind green to 18082 and blue to
18083; both must differ and the candidate port must be available before first
staging. Port 18081 belongs to an unrelated service and is never touched. It does not recreate green and does
not alter the Cloudflare Tunnel. The inverse applies on a later blue-to-green
release. A missing slot service fails in the read-only Compose preflight before
any epoch is accepted or container is changed.

`preprod-switch-ingress` and `preprod-rollback-ingress` intentionally fail closed unless the audited,
root-owned `/usr/local/libexec/happybooking/switch-preprod-ingress` helper is
installed. The executor resolves symlinks and requires a regular file owned by
UID 0 with neither group nor other write bits. Record and approve the helper's
SHA-256 during installation; replace it only through the release change
procedure. That helper is the NAS-local ingress trust boundary.

The mutation invocation is exactly:

```text
switch-preprod-ingress
  --project booking-preprod
  --hostname booking-preprod.happybooking.uk
  --upstream gateway-<candidate slot>:8080
  --release <candidate releaseId>
  --manifest-digest <candidate manifestDigest>
  --source-container-id <approved exact source gateway ID>
  --source-backend-container-id <approved exact source backend ID>
  --source-image-id <approved source gateway Image ID>
  --source-config-image <approved source Config.Image>
  --source-config-hash <approved source Compose config hash>
  --target-container-id <approved exact target gateway ID>
  --target-backend-container-id <approved exact target backend ID>
  --target-image-id <approved target gateway Image ID>
  --target-config-image <approved target Config.Image>
  --target-config-hash <approved target Compose config hash>
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

Readback uses `booking.ingress-readback/v3` and binds the project/hostname,
release and manifest, operation/approval/lease/holder/action identities,
sequence/fencing epoch, immutable rollback target, proof digest, fixed edge
network, exact gateway container IDs/images/Compose labels/aliases, exact
cloudflared identity and hardening, guard mode, and observation time. Every
field must match the mutation command and canonical three-step cycle. The
helper rejects a production hostname, project, container, network, database,
or route.

For the historical green runtime these exact values come only from the pinned
legacy runtime binding. For a candidate they come only from the canonical
immutable `preprod-stage` receipt, whose runtime readback proves the
manifest-bound image, exact backend/gateway container IDs, complete hardened
runtime configuration, and Compose config hash. A syntactically valid digest or
config-hash copied only from a live label is not an authority. These bindings
are included in the helper argv, artifact binding, command digest, pending
marker, proof, and executor readback verification.

The reviewed helper sources are the extensionless launcher
`ops/release/switch-preprod-ingress` and standalone Node implementation
`ops/release/switch-preprod-ingress.mjs`. Install them at
`/usr/local/libexec/happybooking/switch-preprod-ingress` and
`/usr/local/libexec/happybooking/switch-preprod-ingress.mjs`. Both must be
root-owned and non-group/non-other-writable; record and approve both SHA-256
digests. The implementation also verifies its own ownership and mode before
inspecting Docker. The launcher keeps the executor's
fixed extensionless path while preserving explicit ESM parsing on Node 20.
It has no credential source and makes no Cloudflare API request. Create
`/var/lib/happybooking/ingress` as a root-owned mode-0700 directory before the
first call. The helper stores its current secret-free fenced proof there and
combines that proof with fresh Docker inspect/network inspect output for every
independent readback.

Cloudflare configuration remains permanently pinned, outside this helper, to
`booking-preprod.happybooking.uk -> http://gateway-green:8080` on the dedicated
preproduction tunnel. Its account/tunnel/configuration identity is retained as
separate read-only provenance; cutover never fetches or changes it. Any remote
configuration change requires separate authorization and review.

On `booking-preprod-edge`, the fixed logical alias `gateway-green` belongs to
exactly one audited gateway. Docker/Compose may report a physical service alias
twice and may add both the exact inspected container-name alias and exact
12-character container-ID alias; validation uses bounded per-alias counts
rather than array equality. No other alias is allowed.
The helper enumerates the complete network membership and independently
inspects the exact approved green/blue gateway and backend IDs plus the pinned
cloudflared ID. A foreign ID is rejected even when it uses a syntactically
allowed service name, and `gateway-green` on a backend, cloudflared, or second
gateway freezes the action. It disconnects and reconnects by exact container
ID, never by a caller-selected name.

Before mutation the helper records a secret-free, exact-key, canonical-digest
pending marker containing the request digest, exact source/target gateway and
backend IDs, approved images/config hashes, and cloudflared `StartedAt`.
Readback classifies topology as previous, desired, or the single expected
in-flight state. A retry converges from any of those three states without
repeating a completed disconnect/connect. After desired topology is proven, it
restarts the exact `booking-preprod-cloudflared` container only if its observed
`StartedAt` has not already advanced, then re-verifies its immutable image,
token-file command (without reading the token), read-only filesystem, dropped
capabilities, no-new-privileges, no published ports, and edge-only network.
If `docker restart` stops cloudflared and then fails, only the exact pending
desired-alias state may admit that stopped container; the next retry validates
the same ID and hardening, starts it by exact ID, and requires a newer
`StartedAt`. A proof-write/pending-delete crash is likewise closed by an exact
same-request readback and pending cleanup before any inverse switch.
If restart returned successfully but the helper died before proof publication,
the exact same pending identity, desired aliases, hardening, container ID/image,
and monotonically newer `StartedAt` are treated as the completed restart; retry
must not restart cloudflared a second time.

The normal control-plane runs with host PID namespace. The helper lock is bound
to PID, kernel boot ID, process start ticks, the fixed control-plane container
name, its exact daemon container ID, and a canonical lock digest. Recovery
publishes a complete owner through a same-directory transaction directory,
file fsync, mode normalization, atomic directory rename, and parent-directory
fsync; the fixed lock is therefore never created empty or half-written.
Pre-publication temp artifacts and legacy empty/half fixed artifacts require
their exact forensic artifact digest and an absent fixed owner before removal.
For a normal `--rm` exit, recovery first proves the Docker daemon responsive and
accepts only fixed-name plus recorded-full-ID absence, or the same exact stopped
owner, on two reads surrounding unlink. A running/restarted/replacement,
inconsistent lookup, changed artifact, or unavailable daemon freezes recovery. A
killed helper never causes automatic lock deletion. After independently proving
the recorded owner dead, recover only the exact
digest with `switch-preprod-ingress --recover-stale-lock --lock-digest <digest>
--project booking-preprod --hostname booking-preprod.happybooking.uk`; a live,
changed, or mismatched owner remains frozen.
Public probing is a subsequent fenced action; helper readback alone is not
public reachability evidence.

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

Build backend, gateway, and Telegram egress images with the exact
`BOOKING_GIT_SHA` and `BOOKING_RELEASE_ID` build arguments. The egress image
first bootstraps `ca-certificates` from the reviewed base configuration; only a
later layer may replace Debian and Debian-security with explicitly selected
canonical HTTPS mirrors. Official HTTPS endpoints remain the defaults. The
exact selected mirror URLs are required in the build inventory, provenance,
release manifest, and OCI labels. An HTTP URL, credential-bearing URL, omitted
value, or label/evidence drift blocks admission. All final images must carry
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

The same live-container inspection is repeated before and after candidate
probe, singleton transfer, ingress switch, and post-switch observation. It
requires the expected non-root image user, `Privileged=false`, empty PID/IPC
modes and device list, read-only root filesystem, exact capabilities,
security options, networks, mounts, critical environment and loopback port.
Stage-time evidence alone is never accepted after a later container rebuild.

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

An existing lock file still requires human forensic recovery. A pending action
is never blindly cleared and `highestAcceptedFencingEpoch` is never reset or
decreased, including during rollback. Same-fence receipt recovery performs a
fresh action-specific readback. After lease takeover, completed stage,
baseline, migration and singleton actions may be adopted only from an immutable
prior receipt plus independent current-state readback. Ingress pending recovery
uses the root-owned helper's proof chain and two matching remote GETs: an
already-applied PUT is attested without repeating it; a configuration proven
still at the prior target is superseded by the new fenced action and retried.
Any identity mismatch, third state, missing recoverable pending metadata, or
ambiguous remote result remains frozen for human forensics.

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
