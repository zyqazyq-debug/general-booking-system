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
