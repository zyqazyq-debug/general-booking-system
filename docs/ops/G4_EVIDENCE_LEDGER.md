# G4 isolated-preproduction evidence ledger

Status: isolated candidate is deployed and has passed NAS-loopback probes;
G4 remains pending because no public-preprod ingress, fixture-Telegram,
backup/restore, lease/switch, or rollback rehearsal evidence exists.

Owner: Booking NAS/Cloudflare release owner. Approval owner: main scheduler.

This ledger is intentionally non-secret. It records what must be supplied or
observed; it must never contain tokens, passwords, DSNs, chat IDs, secret-file
contents, or Cloudflare credentials.

## Local prerequisites already passed

| Check | Command | Result |
| --- | --- | --- |
| Immutable release and Compose contracts | `node ops/check/run-r1-gates.mjs` | PASS |
| Isolated-input validator behavior | `node --test ops/check/isolated-preprod-input.test.mjs` | PASS, 5 tests |
| Synthetic input shape | `node ops/check/validate-isolated-preprod-input.mjs --input ops/contracts/examples/isolated-preprod-input.fixture.json` | PASS |

The fixture is synthetic. It is evidence of validator behavior only and is not
a deployable configuration.

## Read-only NAS audit receipt

The authorized audit is recorded in
[`G4_NAS_READONLY_AUDIT_20260908.md`](G4_NAS_READONLY_AUDIT_20260908.md).
It established that the observed live deployment is `booking-prod`, with one
`booking-prod_default` network and no observed `booking-preprod` project or
network. Gateway probe receipts did not provide working liveness, readiness,
OpenAPI, or immutable-version evidence. This is a **negative isolation
finding**, not an authorization to change the existing deployment.

## 2026-09-09 isolated candidate receipt

The following receipt was collected against the non-production NAS project
only. It does not authorize or evidence a production release.

| Area | Observed receipt | Result |
| --- | --- | --- |
| Candidate identity | `booking-20260908T173556Z-f460ae8c2092`; Git `f460ae8c2092f831b36aba903deb00b6fcc04be5`; manifest `sha256:8aa8a9e88234689019560938a7c8c9ba6e9c1d5c7b290e3a6255b44b17866140` | PASS |
| Artifact binding | Local immutable-artifact generation and recomputation passed. Backend image `sha256:4b040c8dd1120c9897bff9daf59202566a2d2cca6f468e4758763c5ab8944d50`; gateway image `sha256:edc4f7b447272bd683700e04860caf8d5314fef9b9ab17be41752a37e566fc66` | PASS |
| Isolation | `booking-preprod` project; `booking-preprod-edge` and `booking-preprod-data`; only `127.0.0.1:18082` is published | PASS |
| Candidate probes | NAS loopback GETs to `/livez`, `/readyz`, and `/__ops/version` each returned HTTP 200. Version payload matched the candidate identity and `slot=green` | PASS, loopback only |
| Gateway boundary | Image runs as UID 101 (`nginx`), root filesystem is read-only, and the committed preprod config is a read-only bind mount. The gateway is connected only to the edge network. | PASS |
| Side effects | Backend reports `BOOKING_RUNTIME_ROLE=standby`, `BOOKING_WORKERS_ENABLED=false`, `TELEGRAM_ENABLE_WEBHOOK=false`, and no polling webhook deletion | PASS |

The source archive recorded for this candidate was
`sha256:cf178e735c0413da417cb1e2b9be4b92c999419c541c529939b554bc8d6b4ecd`.
The manifest is retained under the isolated project's `.g4/artifacts` path;
no secret contents are included in this ledger.

## Required real G4 input and evidence

| Area | Required non-secret evidence | Owner | Status |
| --- | --- | --- | --- |
| Isolation | Real `booking-preprod` project, data, secret roots and distinct edge/data network names | NAS release owner | PASS (candidate only) |
| Immutable identity | Candidate manifest path plus manifest, backend-image, and gateway-image digests | Runtime/CI owner | PASS (candidate only) |
| Read-only probes | Candidate slot and preprod ingress base URLs; `/livez`, `/readyz`, `/__ops/version` receipts | Runtime/CI owner | PARTIAL: loopback candidate PASS; public preprod absent |
| Edge | Stable preprod edge reference, active-upstream path, candidate upstream name | NAS/Cloudflare owner | NOT PROVIDED |
| Telegram | Separate fixture-bot reference and duplicate-delivery receipt location; root webhook remains `/telegram/webhook` | Telegram owner | NOT PROVIDED |
| Database | Isolated armed-gate, backup, and restore receipt locations plus explicit isolated-target acknowledgement | Database owner | PARTIAL: isolated bootstrap exists; no backup/restore drill |
| Singleton/rollback | Active/candidate slots, expected generation and fencing epoch, workers disabled, switch and observation receipt locations | Runtime/NAS owner | PARTIAL: workers disabled; no lease/switch/rollback rehearsal |

## Authorization boundary

Before any external action, an authorization must identify the real
`booking-preprod` target, manifest digest, candidate slot, expected generation,
change window, approver, and rollback owner. The first authorized action may be
read-only collection only. It must not alter NAS, Docker, Cloudflare, DNS,
Tunnel, Telegram, PostgreSQL, Redis, storage, or production state.

G4 remains failed/pending until all rows above are evidenced against an
isolated target and the resulting input passes
`validate-isolated-preprod-input.mjs --verify-local-evidence`. G5 cannot start
until that rehearsal is accepted.
