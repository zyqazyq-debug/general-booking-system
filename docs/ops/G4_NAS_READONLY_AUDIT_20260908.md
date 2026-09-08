# G4 NAS read-only audit — 2026-09-08

## Scope and safety boundary

This audit was performed against the NAS using the explicitly authorized
read-only SSH account. It used only container listing/inspection, filesystem
metadata listing, network listing, configuration route-structure reading, and
HTTP `GET`/`HEAD` probes. It did **not** read `.env` contents, inspect secrets,
change a container, restart a process, execute inside a container, change
Cloudflare/DNS/Tunnel/Telegram, or access a database.

This record intentionally contains no token, password, DSN, chat identifier,
secret-file content, or private endpoint address.

## Observed runtime topology

| Component | Observed state | Evidence relevant to G4 |
| --- | --- | --- |
| Compose project | `booking-prod` | Production-named project; not the required `booking-preprod` target. |
| Backend | `booking-prod-backend`, healthy, internal port `3001` | Image digest: `sha256:afdef8a02e961df97e0c5227b1608108a0c31a1b9ceeedc4ab2a7253a7bbaf0f`. |
| Gateway/frontend | `booking-prod-gateway-frontend`, port `8080` published, no container healthcheck | Image digest: `sha256:cd6199a28d8531d15609af85adeb5b2ecce48445da0ee973d2cb4b336d30a2db`. |
| PostgreSQL | `booking-prod-postgres`, healthy, host port `5433` published | Stateful data root is under the production project. |
| Redis | `booking-prod-redis`, healthy, host port `6379` published | Stateful data root is under the production project. |
| Network | one local bridge, `booking-prod_default` | No `booking-preprod` network was listed. |
| Project metadata | Compose file exists under the production project; observed SHA-256 `ed3ce7245e4750d11512479c9fe5354eaba1b993fe9687115266de812861e365` | File identity is not a release manifest and was not treated as one. |

The gateway mounts a built frontend and a host-side Nginx configuration. The
gateway's route structure serves static fallback content and proxies `/api/` to
the internal backend. This is topology evidence only; it does not establish an
immutable candidate or a G4 release identity.

The inspected backend and gateway image labels identify their Compose project
and service only. Neither carries a source revision, release-manifest digest,
or other label that can establish lineage to the current workspace candidate.

## Read-only gateway probe receipts

All requests below targeted the local published gateway origin. Status and
content type were observed without following any external route.

| Path | Result | G4 interpretation |
| --- | --- | --- |
| `/` | `200`, `text/html` | Frontend is reachable. |
| `/livez` | `404`, HTML | Required liveness probe is not available at this origin. |
| `/readyz` | `200`, HTML | This is a frontend fallback response, not verified readiness evidence. |
| `/api-json` | `404`, HTML | OpenAPI identity cannot be collected from this origin. |
| `/__ops/version` | `200`, HTML | This is a frontend fallback response, not verified immutable version evidence. |
| `/api/livez` | `404`, JSON | No working API-prefixed liveness endpoint observed. |
| `/api/readyz` | `404`, JSON | No working API-prefixed readiness endpoint observed. |

## G4 decision

**G4 is NOT PASSED.** The observed environment is a single production-named
deployment and cannot be reclassified as isolated preproduction merely because
it is reachable or healthy at the container level.

The following required G4 evidence is absent:

1. A separate `booking-preprod` project, state roots, secrets, and edge/data
   networks.
2. A real immutable release manifest connecting the declared candidate to the
   observed backend and gateway image digests; inspected image labels do not
   supply that lineage.
3. Working, non-fallback receipts for `/livez`, `/readyz`, and
   `/__ops/version` on a candidate slot and its preprod ingress origin.
4. A separate fixture Telegram bot/reference and duplicate-delivery receipt.
5. Isolated database armed-gate, backup, restore, lease/fencing, edge-switch,
   observation, and rollback receipts.

No production change is authorized by this audit. The next safe step is to
create and declare a genuinely isolated preproduction target in a separately
authorized change window, then run the existing G4 validator and rehearsal
against that target.

## Reproducibility notes

The observations can be repeated using non-mutating equivalents of:

```text
sudo docker ps -a
sudo docker inspect <booking production containers>
sudo docker network ls
find <production project root> -maxdepth 1 (metadata only)
curl -I/GET <local published gateway paths>
```

Do not add `docker exec`, Compose lifecycle commands, secret reads, database
commands, HTTP mutation methods, or Cloudflare/Tunnel changes to this audit.
