# G4 isolated-preproduction evidence ledger

Status: local prerequisites passed; read-only NAS audit completed; real
isolated-target inputs still absent.

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

## Required real G4 input and evidence

| Area | Required non-secret evidence | Owner | Status |
| --- | --- | --- | --- |
| Isolation | Real `booking-preprod` project, data, secret roots and distinct edge/data network names | NAS release owner | NOT PROVIDED |
| Immutable identity | Candidate manifest path plus manifest, backend-image, and gateway-image digests | Runtime/CI owner | NOT PROVIDED |
| Read-only probes | Candidate slot and preprod ingress base URLs; `/livez`, `/readyz`, `/__ops/version` receipts | Runtime/CI owner | NOT PROVIDED |
| Edge | Stable preprod edge reference, active-upstream path, candidate upstream name | NAS/Cloudflare owner | NOT PROVIDED |
| Telegram | Separate fixture-bot reference and duplicate-delivery receipt location; root webhook remains `/telegram/webhook` | Telegram owner | NOT PROVIDED |
| Database | Isolated armed-gate, backup, and restore receipt locations plus explicit isolated-target acknowledgement | Database owner | NOT PROVIDED |
| Singleton/rollback | Active/candidate slots, expected generation and fencing epoch, workers disabled, switch and observation receipt locations | Runtime/NAS owner | NOT PROVIDED |

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
