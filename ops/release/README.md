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

The historical `generate-sbom.mjs` entry point is disabled because it does **not** inspect an image. Use `generate-build-input-inventory.mjs` to emit `booking.build-input-inventory/v1`, an exact, non-empty digest inventory of the Dockerfile, package manifest/lockfile, and gateway configuration inputs listed in `ops/contracts/build-input-inventory.schema.json`. That inventory is reproducible source evidence, not an SBOM, and it is not accepted as a manifest `sbomDigest` input.

The release gate accepts only a normalized `booking.image-sbom/v2` document matching `ops/contracts/image-sbom.schema.json`. Version 2 replaces the never-production-admitted v1 draft so the native scanner evidence cannot be omitted. It binds the exact component, clean Git SHA, immutable image repository/digest, pinned Syft version and native-report digest, and contains non-empty package/PURL and absolute-path file/SHA-256 inventories. `generate-image-sbom.mjs` is the only supported generator. It scans the exact `repository@sha256` reference with Syft 1.51.1, forces squashed/all-file/SHA-256 cataloging after removing ambient `SYFT_*` overrides, and preserves both the native Syft JSON and the canonical normalized document as immutable files.

Before and after the scan, the generator independently runs Docker image inspection and requires the exact repository digest, `org.opencontainers.image.revision` Git SHA, `uk.happybooking.component` label, and stable image ID/repository-digest set. The Syft report must independently identify an image source with the same manifest and repository digest. It fails closed on a wrong scanner/schema version, absent PURL, duplicate package, absent/duplicate/non-absolute file path, missing/multiple/non-lowercase SHA-256 digest, existing output, or any scan-time image drift.

Closing G4 requires this executable chain, all pinned to the same immutable `repository@sha256` identity:

1. Build the backend and gateway images, resolve their immutable digests, and make the exact images available to the scanner without replacing or retagging them during the run.
2. Install Syft 1.51.1 at `/usr/local/bin/syft` from the official release archive and verify the archive before installation. The published SHA-256 values are `8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3` for `syft_1.51.1_linux_amd64.tar.gz` and `a7fd2b784e6664acd44719270574f6cd8c6864fc2b1700bf9099bd1cccda7d7f` for `syft_1.51.1_linux_arm64.tar.gz`. Preserve the downloaded checksum list and its verified release signature as installation evidence.
3. Generate the native and normalized evidence outside the Git worktree. For each component run:

   ```text
   node ops/release/generate-image-sbom.mjs --execute true \
     --component <backend|gateway> --git-sha <40-hex> \
     --image <registry/repository> --image-digest sha256:<64-hex> \
     --native-output <evidence>/<component>.syft.json \
     --output <evidence>/<component>.image-sbom.json
   ```

   The generator resolves Docker only from Synology Container Manager's fixed binary path or `/usr/bin/docker`, and Syft only from `/usr/local/bin/syft`. It resolves symlinks and requires each target to be a root-owned regular file with no group/other write permission; executable paths cannot be overridden from the CLI. Both output parents must be root-owned mode-0700 directories, and existing evidence is never overwritten. Run it from a root-controlled release checkout. A test dependency may inject executables and insecure temporary paths only through the exported library API.
4. Generate and validate the local provenance binding, then attach the native SBOM and provenance to the same OCI image digest with a pinned signing/attestation tool.
5. Pull both attestations back from the registry, verify signatures against the approved identity, and compare the retrieved subject, SBOM digest, provenance materials, image digest, and manifest bindings before recording G4 as passed.

Steps 2 and 3 are implemented locally and covered by `node --test ops/check/syft-image-sbom.test.mjs`. Registry attachment/signing and independent pull-back verification in steps 4 and 5 are intentionally not implemented: no registry trust root, approved signing identity, immutable referrer policy, or credential boundary is defined in this repository. Until those inputs exist and both retrieved attestations are independently verified, G4 remains unmet; local generation must not be reported as registry attestation.

`generate-provenance.mjs` requires both `--native-sbom` and `--sbom`, recomputes the native report digest recorded in the normalized document, and validates the image SBOM before emitting the exact `ops/contracts/local-provenance.schema.json` statement. Release generation similarly requires `--backend-native-sbom` and `--gateway-native-sbom` in addition to the normalized SBOM inputs. The provenance predicate and build type are deliberately local Booking URNs, and its two materials bind the normalized SBOM document digest and the same image repository/digest as its sole subject. The normalized SBOM transitively binds the preserved native Syft report. This is local provenance evidence only: it is not SLSA provenance, a registry attestation, or proof of a hosted builder.

The manifest/provenance scripts are local-only: they do not build, sign, attest, or push images, and they refuse a dirty Git worktree. Only `generate-image-sbom.mjs` performs an image scan. Generate evidence files outside the repository (otherwise their untracked files intentionally make the gate fail). The `booking.release/v2` manifest preserves its existing `sbomDigest` and `provenanceDigest` fields and additionally binds the H5 directory, route contract, migration catalog, fixed probe paths, and exact Compose file.

Use an immutable image repository (no tag, digest supplied separately); placeholder registries and mutable tags are rejected. `validate-artifacts.mjs` recomputes local document bindings and rejects schema, source, image, SBOM-material, or supplied-document drift. It does not independently rescan image contents. Passing it does not satisfy G4 by itself and is not an image push, registry attestation, deployment, or live probe.

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
