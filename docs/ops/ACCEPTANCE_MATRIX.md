# Release acceptance matrix

| Gate | Development | Inactive NAS slot | Active/public route |
|---|---|---|---|
| Identity | no production identity | manifest SHA/digests exact | `/__ops/version` matches manifest |
| Files | source bind allowed | no source/H5 bind, read-only root | active slot remains immutable |
| Network | loopback dev ports | backend/data internal only | stable edge is the only published runtime port |
| Live | watcher process responds | `/livez` 200 | edge-to-active `/livez` 200 |
| Ready | optional dev dependencies | DB, Redis, migration floor, config | `/__ops/readyz` matches active release |
| API/UI | HMR and proxy | HTML/assets/API/login/short links | same routes repeated through Cloudflare |
| Telegram | separate dev bot | workers disabled; route declaration checked | fixed root webhook; idempotent delivery evidence |
| Database | dev volume | real backup and expand compatibility | write smoke and observation window |
| Singleton | not production | standby has no lease | exactly one holder and current fencing epoch |
| Rollback | restart dev process | discard candidate | switch to previous immutable release and re-probe |

## Required route set

- `/`
- manifest-named liveness/readiness/version paths
- representative `/api/*`
- login/session flow
- `/s/:slug`
- `/r/:code`
- legacy bare slug if still supported
- `/telegram/webhook` declaration at the root, with no `/api` rewrite

R1 performs only contract and fixture checks. Real login, short-link, Telegram, database-write, Cloudflare, and rollback drills are R2/R3 gates requiring isolated fixtures and explicit authorization.
