# Read-only release gates

Run the R1 contract suite from the repository root:

```powershell
node ops/check/run-r1-gates.mjs
```

Individual interfaces:

```powershell
node ops/release/validate-release.mjs --manifest <release-manifest.json>
node ops/release/validate-transition.mjs --state <deploy-state.json> --to <PHASE> --static-only true
node ops/check/probe-slot.mjs --base-url <internal-slot-url> --manifest <manifest> --slot <blue|green>
node ops/check/probe-ingress.mjs --base-url <public-url> --manifest <manifest> --ingress <ingress-contract>
```

All commands are read-only. They emit one `booking.gate-result/v1` JSON object and return non-zero on uncertainty, identity mismatch, timeout, or malformed input. `validate-transition` checks only the static graph and deliberately emits `STATIC_TRANSITION_LEGAL_NOT_AUTHORIZED`; it does not inspect the trusted clock, prove live lease ownership, perform CAS, or authorize an external mutation, and is therefore not an R1 release gate.

The exception is the explicitly armed local state-ledger command
`ops/release/manage-deploy-state.mjs`. It requires `--execute true` plus exact
environment/project, approval, manifest, generation, fencing epoch, lease ID,
and holder inputs. Its canonical state path is derived from
`BOOKING_DEPLOY_STATE_ROOT`; caller-supplied paths and timestamps are rejected.
It never performs an infrastructure change. See
`ops/release/README.md` and run
`node --test ops/check/deploy-state-cas.test.mjs` before using it in a G4
rehearsal.

The Cloudflare ingress helper has a network-free mock suite:

```powershell
node --test ops/check/switch-preprod-ingress.test.mjs
```

The suite proves scope pinning, unrelated-config preservation, version/digest
drift rejection, fenced proof readback, and credential non-disclosure. It does
not contact Cloudflare and is not evidence that a live tunnel changed.

The NAS control-plane launcher also has a Docker-free argument-plan suite:

```powershell
node --test ops/check/preprod-control-plane-launcher.test.mjs
```

It executes only the launcher's inert dry-run path and verifies the fixed image,
mounts, hardening options, entrypoint allowlist, argument boundaries and scope
rejection. It does not start a container or inspect NAS state.

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
