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
