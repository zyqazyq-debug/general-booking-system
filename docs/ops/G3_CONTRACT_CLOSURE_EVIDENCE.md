# G3 contract-closure evidence

Status: local closure passed; external preproduction is not started.

Owner: Main scheduler (contract and release-gate owner).

## Closed failure items

| Item | Closure | Re-runnable evidence |
| --- | --- | --- |
| Runtime OpenAPI had SDK-facing success responses without payload schemas | Every discovered success response is now described with a concrete DTO or, for HTML link resolution, an explicit `text/html` response. | `npm --prefix frontend run generate:api -- --input http://127.0.0.1:3101/api-json` reports `Generated 88 operations`. |
| Generated client could drift from runtime OpenAPI | The generator compares a fresh runtime document with `frontend/src/generated/api.ts`. | `node tools/ci/verify-generated-api.js` passes ingress coverage and reproducibility. |
| Admin order and collection ports returned `unknown` and could leak entity relations | `AdminOrderPort` and `AdminAgencyPort` now publish narrow read-only projections. Their owning adapters map values explicitly and exclude credentials, contact identifiers, internal notes, wallet values, and relation internals. | `npm --prefix backend test -- --runInBand --runTestsByPath src/domains/order/adapters/admin-order.adapter.spec.ts src/domains/agency/adapters/admin-agency.adapter.spec.ts` passes 2/2 tests. |
| Cross-domain boundary regression | Backend dependency-cruiser and runtime-import checks remain clean after the new adapter projections. | `npm run quality:gates` passes the backend dependency-boundary gate and the full G2 sequence. |

## Evidence limits and open items

- These are local engineering results. No real user data, NAS container, Cloudflare/Tunnel configuration, DNS, Telegram bot, database, Redis, or external ingress was contacted or changed.
- G4 is **not passed**. Its remaining required evidence is the real, isolated `booking-preprod` input and authorized read-only collection/probes described in `G4_ISOLATED_PREPROD_RUNBOOK.md`.
- G5 is **not started**. It requires a completed and accepted G4 rehearsal plus explicit per-change production authorization.

## Handoff

The next owner is the Booking NAS/Cloudflare release owner for the external G4 evidence. The main scheduler retains approval control and must reject any production mutation before G4 evidence is accepted.
