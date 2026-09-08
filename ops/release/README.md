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

Future mutating commands must require all of `--execute`, `--approval-id`, `--expected-generation`, and `--manifest-digest`. Dry-run remains the default. No such command is implemented in R1.

## Local immutable-artifact gate

`generate-sbom.mjs`, `generate-provenance.mjs`, and `generate-manifest.mjs` are local-only: they do not build or push images, and all refuse a dirty Git worktree. Generate artifact files outside the repository (otherwise their untracked files intentionally make the gate fail). The manifest binds the checked-out Git SHA, immutable backend/gateway image digests, both SBOM and SLSA-style provenance document digests, an H5 directory digest, `pages.json` route-contract digest, migration catalog digest, and the fixed probe paths.

Use an immutable image repository (no tag, digest supplied separately); placeholder registries and mutable tags are rejected. `validate-artifacts.mjs` recomputes every local binding from the same inputs and rejects drift. A passing local gate is evidence of reproducible inputs only; it is not an image push, registry attestation, deployment, or live probe.
