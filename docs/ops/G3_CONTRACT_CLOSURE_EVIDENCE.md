# G3 contract-closure evidence

Status: local contract closure passed; isolated preproduction has started, but
security remediation and the remaining external G4 rehearsal are not closed.

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
- Runtime dependency security is **not passed**. A compatibility-only
  `npm audit fix --prefix backend --package-lock-only --omit=dev` was applied,
  followed by a clean install and the full quality gate. A fresh
  `npm audit --prefix backend --omit=dev --json` found 48 vulnerabilities:
  1 critical, 8 high, 37 moderate, and 2 low. The unused direct `sqlite3`
  package was then removed after confirming that runtime data sources are
  PostgreSQL-only; its removal passed the backend build and targeted tests.
  The lockfile was then pruned and reinstalled cleanly, removing stale
  `tar`/`node-gyp` entries that were no longer reachable from production
  dependencies. The final publish-scope audit is 41 vulnerabilities: 0
  critical, 4 high, 37 moderate, and 0 low. The four high findings are the
  AdminJS editor/deprecated terser chain; resolving them requires an AdminJS
  major upgrade. Those remaining findings require compatibility tests and a
  fresh runtime-image audit before G5 can be considered; they are not silently
  included in the compatibility lock update.
- G4 is **not passed**. The internal `booking-preprod` release-slot probe now
  passes, but the public isolated ingress, fixture Telegram duplicate-delivery,
  isolated backup/restore, fenced singleton transfer, and rollback rehearsal
  remain required. See `G4_EVIDENCE_LEDGER.md` and
  `G4_ISOLATED_PREPROD_RUNBOOK.md`.
- G5 is **not started**. It requires a completed and accepted G4 rehearsal plus explicit per-change production authorization.

## Handoff

The next owner is the Booking NAS/Cloudflare release owner for the external G4 evidence. The main scheduler retains approval control and must reject any production mutation before G4 evidence is accepted.
