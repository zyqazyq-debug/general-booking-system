# Compose ownership boundaries

- `compose.dev.yml`: source bind mounts and watcher/HMR behavior. Dev-only.
- `compose.data.yml`: long-lived PostgreSQL and Redis. No host-published ports.
- `compose.edge.yml`: the single stable runtime ingress.
- `compose.release.yml`: immutable blue/green application slots. No source or asset bind mounts.

These files are contract skeletons, not authorization to deploy. R2 must add application support for `/livez`, `/readyz`, `/__ops/version`, `*_FILE` secret loading, container-safe frontend proxy configuration, non-root images, and singleton fencing before a Compose render may be accepted for production.
