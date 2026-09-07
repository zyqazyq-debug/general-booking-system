# G4 isolated-preprod input and evidence runbook

## Purpose and boundary

This runbook prepares a **local, non-secret input declaration** for the
`booking-preprod` G4 rehearsal. It proves only that the declared input is
complete and internally consistent. It does not contact NAS, Docker,
Cloudflare, DNS, Tunnel, PostgreSQL, Redis, Telegram, or any production
service, and it does not establish that a fixture value is true in an external
environment.

The input schema is
`ops/contracts/isolated-preprod-input.schema.json`. The checked fixture is
`ops/contracts/examples/isolated-preprod-input.fixture.json`; its `/srv/fixture`
paths, `.test` hosts, digests, and bot reference are deliberately synthetic.
They must never be copied as a deployment configuration.

## Local preflight

Create a non-secret JSON input with every field required by the schema. The
validator rejects missing fields, extra fields, production identity
markers, non-isolated roots, mixed edge/data networks, malformed digests,
credential-bearing URLs, a candidate with workers enabled, slot/upstream
mismatch, and an attempt to embed external authorization.

```powershell
node ops/check/validate-isolated-preprod-input.mjs `
  --input <local-non-secret-g4-input.json>

node --test ops/check/isolated-preprod-input.test.mjs
```

The default command does not dereference path fields. After receipts and local
copies of the manifests have been deliberately collected, the following
optional check verifies that only the declared local evidence files exist:

```powershell
node ops/check/validate-isolated-preprod-input.mjs `
  --input <local-non-secret-g4-input.json> --verify-local-evidence
```

`--verify-local-evidence` is a filesystem existence check only. It neither
parses secrets nor makes a network request.

## Required input inventory

| Area | Required declaration | What it proves locally |
|---|---|---|
| Environment | exact name `booking-preprod`; `externalChangesAuthorized=false` | this is a local preflight, not a release permit |
| NAS isolation | distinct project, data, and secret roots | the declared roots are structurally distinct and preprod-named |
| Networks | distinct `booking-preprod-*` edge and data networks | no network identity is silently shared in the input |
| Release | manifest path/digest and backend/gateway digests | an immutable candidate identity has been named, not verified remotely |
| Probes | candidate and ingress origin URLs plus `/livez`, `/readyz`, `/__ops/version` | intended read-only probe targets are complete |
| Edge | stable edge reference, active-upstream file path, candidate upstream | candidate route matches candidate slot before any switch |
| Telegram | `fixture:<reference>`, root webhook path, duplicate-delivery receipt path | only an isolated fixture identity may later be used |
| Database | armed-gate, backup, and restore receipt paths | later DB evidence has explicit accountable locations |
| Lease | active/candidate slots, expected generation/fencing epoch, disabled workers, switch receipt path | the future transfer is explicitly fenced and starts side-effect-free |
| Rollback | bounded observation window, prior manifest, observation receipt | rollback proof is planned before a switch |

No value in this input may be a token, password, secret-file content, Cloudflare
credential, Telegram chat identifier, database DSN, or copied `.env` content.
The Telegram field is a fixture *reference*, not a bot username or token.

## External steps requiring explicit user authorization

The local validator intentionally cannot grant any of these actions. A separate
authorization must name the real target, manifest digest, candidate slot,
expected generation, change window, approver, and rollback owner before each
step.

1. Read-only evidence collection from the declared `booking-preprod` NAS
   project: manifest bytes/digest, image digest resolution, non-secret Compose
   topology, network names, secret file permissions (not contents), and edge
   upstream state.
2. Read-only public and inactive-slot GET probes for `/livez`, `/readyz`, and
   `/__ops/version`; identity must match the real manifest and candidate slot.
3. Viewer-only verification of the preprod Cloudflare/Tunnel/origin relation,
   with no DNS, Tunnel, WAF, or origin update.
4. An isolated database backup/readability/restore drill and migration-head
   check using the existing isolated-target migration guard. The target must
   remain non-production and independently acknowledged.
5. A fixture-only Telegram header and duplicate-`update_id` smoke. It must use
   a separate test bot and prove no production bot, chat, token, or side effect
   is involved.
6. Only after the prior evidence is accepted: a preprod-only candidate start,
   durable lease release/acquire with the declared fencing epoch, edge switch,
   bounded observation, and an immutable previous-slot rollback rehearsal.

## Production-prohibited actions

This G4 input and its local preflight never authorize production NAS, a
production database/Redis/storage root, a production Telegram bot, Cloudflare
or DNS/Tunnel writes, production edge reloads, production migrations, or a
production slot switch/rollback. Do not invoke `docker compose up/down`,
`docker exec`, migration execution, webhook registration/deletion, or an HTTP
POST to `/telegram/webhook` while performing local preflight.

Stop the rehearsal immediately if an external observation contradicts any
declared identity, if roots/networks/bots are shared, if an immutable manifest
cannot be resolved, if probe identity differs, if receipt paths are absent, if
the candidate has workers enabled or lacks the expected lease/fencing epoch, or
if any step would need a secret value or a production mutation to continue.
