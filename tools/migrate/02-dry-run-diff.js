const path = require('node:path');
const { inspectMigrations, verifyExpandOnly, MigrationSafetyError } = require('./lib/migration-safety');

try {
  const inspection = inspectMigrations(path.join(process.cwd(), 'backend', 'src', 'migrations'));
  const plan = verifyExpandOnly({ entries: inspection.entries, applied: [] });
  console.log('[MIGRATE GUARD 02] PASS head=%s pending=%d expand-only=true', plan.head || 'none', plan.pending.length);
} catch (error) {
  const detail = error instanceof MigrationSafetyError ? error.message : 'unable to inspect migrations';
  console.error('[MIGRATE GUARD 02] FAIL: %s', detail);
  process.exitCode = 1;
}
