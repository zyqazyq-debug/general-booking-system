# Isolated migration safety gate

These tools are deliberately unable to reach NAS, production, pre-production, or a remote database. An executable target must be explicitly marked with `BOOKING_MIGRATION_TARGET=isolated`, use a loopback PostgreSQL host, use a `booking_isolated_`, `booking_local_`, `booking_dev_`, `booking_test_`, or `booking_e2e_` database name, and set `BOOKING_MIGRATION_EXECUTE=isolated-db-only`.

The default mode is plan-only: it generates an identity-fingerprinted receipt and never starts `psql`, `pg_dump`, `pg_restore`, or TypeORM. Before any armed operation, `psql` must read back the exact database and role named in the explicit target. `03-auto-backup.js --execute` then creates a custom-format dump, calculates a SHA-256 checksum, and calls `pg_restore --list` before writing a receipt. Restore drills also require a different `BOOKING_RESTORE_DRILL_DATABASE` beginning with `booking_restore_`.

`migration:run:safe` checks the target's actual TypeORM migration table, rejects unknown or destructive pending migrations, produces and verifies a backup, then applies migrations to the isolated loopback target. A migration rollback is not an execution path: `migration:revert` exits non-zero. Application rollback must use the release state machine and a later approved contract migration.

The state path is `IDLE -> TARGET_VALIDATED -> PLAN_VERIFIED -> BACKUP_PLANNED -> BACKUP_VERIFIED -> RESTORE_PLANNED -> RESTORE_VERIFIED -> MIGRATION_APPLIED`. Receipts omit passwords and usernames; they retain only a target fingerprint, database name, migration head, backup checksum/readability result, and restore-drill identity.

Run the hermetic tests with `node --test tools/migrate/migration-safety.test.js`. They use temporary source fixtures and mock command runners only.
