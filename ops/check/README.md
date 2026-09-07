# Read-only release gates

Run the R1 contract suite from the repository root:

```powershell
node ops/check/run-r1-gates.mjs
```

Individual interfaces:

```powershell
node ops/release/validate-release.mjs --manifest <release-manifest.json>
node ops/release/validate-transition.mjs --state <deploy-state.json> --to <PHASE> --expected-generation <N>
node ops/check/probe-slot.mjs --base-url <internal-slot-url> --manifest <manifest> --slot <blue|green>
node ops/check/probe-ingress.mjs --base-url <public-url> --manifest <manifest> --ingress <ingress-contract>
```

All commands are read-only. They emit one `booking.gate-result/v1` JSON object and return non-zero on uncertainty, identity mismatch, timeout, or malformed input.

`probe-ingress` validates that the declared Telegram webhook path is exactly `/telegram/webhook`, but deliberately does not invoke it. A real webhook smoke requires an R2 test fixture, secret-token validation, persistent `update_id` idempotency, and explicit authorization.

## G4 isolated-preprod local input

Validate a complete, non-secret G4 rehearsal declaration without contacting an
external system:

```powershell
node ops/check/validate-isolated-preprod-input.mjs --input <local-non-secret-g4-input.json>
node --test ops/check/isolated-preprod-input.test.mjs
```

See `docs/ops/G4_ISOLATED_PREPROD_RUNBOOK.md` for the mandatory external
authorization boundary and production-prohibited actions.

The legacy `deploy-prod.ps1` and `stop-prod.ps1` entrypoints are intentionally local fail-closed stubs. They exit `80` and never invoke SSH, Docker, NAS, or container commands. The R1 suite tests this invariant.
