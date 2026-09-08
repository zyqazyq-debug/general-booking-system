# G3 contract-closure evidence

Status: local contract closure passed; isolated preproduction has started, but
security remediation and the remaining external G4 rehearsal are not closed.

Owner: Main scheduler (contract and release-gate owner).

## Closed failure items

| Item | Closure | Re-runnable evidence |
| --- | --- | --- |
| Runtime OpenAPI had SDK-facing success responses without payload schemas | Every discovered success response is now described with a concrete DTO or, for HTML link resolution, an explicit `text/html` response. | `npm --prefix frontend run generate:api -- --input http://127.0.0.1:3101/api-json` reports `Generated 88 operations`. |
| Generated client could drift from runtime OpenAPI | The generator compares a fresh runtime document with `frontend/src/generated/api.ts`. | Under the Node 20 CI/container baseline, `node tools/ci/verify-generated-api.js` passes ingress coverage and reproducibility after generating 91 operations. |
| Release probes had runtime bodies but no OpenAPI success-payload schemas | `/livez`, `/readyz`, and `/__ops/version` retain their raw release transport contract and now declare concrete, non-secret Swagger DTOs (including `503 not-ready`). | The regenerated client contains typed operations and `OpsLivenessResponseDto` / `OpsReadinessResponseDto`; the same Node 20 generated-API gate passes. |
| Admin order and collection ports returned `unknown` and could leak entity relations | `AdminOrderPort` and `AdminAgencyPort` now publish narrow read-only projections. Their owning adapters map values explicitly and exclude credentials, contact identifiers, internal notes, wallet values, and relation internals. | `npm --prefix backend test -- --runInBand --runTestsByPath src/domains/order/adapters/admin-order.adapter.spec.ts src/domains/agency/adapters/admin-agency.adapter.spec.ts` passes 2/2 tests. |
| Cross-domain boundary regression | Backend dependency-cruiser and runtime-import checks remain clean after the new adapter projections. | `npm run quality:gates` passes the backend dependency-boundary gate and the full G2 sequence. |

## Evidence limits and open items

- These are local engineering results. No real user data, NAS container, Cloudflare/Tunnel configuration, DNS, Telegram bot, database, Redis, or external ingress was contacted or changed.
- Backend runtime dependency security is locally **passed**, not yet
  runtime-image verified. A compatibility-only `npm audit fix --prefix backend
  --package-lock-only --omit=dev` was applied, then `sqlite3` was moved from
  production dependencies into the development/test dependency graph after
  confirming runtime data sources are PostgreSQL-only. The remaining AdminJS
  editor chain is a development-only
  administration panel: `AppModule` now loads it dynamically only outside
  production and test modes, and its packages are declared in
  `devDependencies`. A production-module regression test proves the panel
  cannot load in production. Finally, direct `uuid` is pinned to `13.0.1`.
  A clean development install, targeted tests, backend build, and fresh
  `npm audit --prefix backend --omit=dev --json` all pass; the latter reports
  0 critical, 0 high, 0 moderate, and 0 low findings. `npm ls --omit=dev`
  also excludes every AdminJS package from the publish dependency graph.
  This is source/lockfile evidence only; it still requires a freshly built,
  scanned runtime image before it becomes G4 or G5 evidence.
- This backend result is deliberately not a whole-repository security claim.
  The frontend is compiled in a multi-stage image and only static assets enter
  the final Nginx image, so its package audit is build-supply-chain evidence,
  not a final-runtime-image scan. Its current publish-scope audit has 52
  findings (15 high, 15 moderate, 22 low), concentrated in the pinned Uni-App
  compiler stack and Vite; a fresh final gateway-image scan is not yet
  available. The root workspace's tool-only dependency audit likewise has
  findings and is not an application-runtime image. Both must be tracked and
  remediated or explicitly risk-accepted before G5; neither is hidden by the
  clean backend result.
- The OpenAPI generation gate deliberately starts a test-only in-memory
  database. It requires the test `sqlite3` driver, which is absent from the
  production graph. This workstation runs Node 25 and has no compatible
  prebuilt `sqlite3` binding; its locally installed Visual Studio toolchain
  also lacks ClangCL, so the contract-generation process cannot start here.
  A SHA-256-verified, temporary official Node 20.20.2 runtime was therefore
  used to rebuild the test binding and run `verify-generated-api.js`; the gate
  passed after regeneration. CI remains pinned to Node 20 and must retain this
  check as the durable cross-machine receipt.
- The runtime dependency remediation is committed locally, but is **not yet
  deployed** to `booking-preprod`. The NAS legacy Docker builder completed the
  new image's dependency-install command but remained idle while committing
  the next layer for more than 14 minutes despite 8.4 TB free storage; that
  isolated build was stopped before it produced an image. The currently
  running preprod candidate therefore remains the earlier release and cannot
  be used as runtime-image evidence for the clean production audit. An
  alternate reproducible image-build path is required before this remediation
  can enter G4. The NAS reports Docker 24 on the Btrfs storage driver and has
  no `docker buildx` command installed; do not install a builder plugin or
  restart Docker without explicit infrastructure authorization.
- G4 is **not passed**. The internal `booking-preprod` release-slot probe now
  passes, but the public isolated ingress, fixture Telegram duplicate-delivery,
  isolated backup/restore, fenced singleton transfer, and rollback rehearsal
  remain required. See `G4_EVIDENCE_LEDGER.md` and
  `G4_ISOLATED_PREPROD_RUNBOOK.md`.
- G5 is **not started**. It requires a completed and accepted G4 rehearsal plus explicit per-change production authorization.

## Handoff

The next owner is the Booking NAS/Cloudflare release owner for the external G4 evidence. The main scheduler retains approval control and must reject any production mutation before G4 evidence is accepted.
