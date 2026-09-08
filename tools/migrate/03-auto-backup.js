const fs = require('node:fs');
const path = require('node:path');
const {
  commandForBackup,
  inspectMigrations,
  receipt,
  run,
  sha256File,
  transition,
  validateTarget,
  verifyTargetIdentity,
  verifyExpandOnly,
  writeReceipt,
  STATES,
  MigrationSafetyError,
} = require('./lib/migration-safety');

function loadEnvironment() {
  const dotenvPath = path.join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) require('dotenv').config({ path: dotenvPath });
}

function backupPathFor(target) {
  const root = path.resolve(process.cwd(), 'artifacts', 'migration-backups');
  const requested = process.env.BOOKING_MIGRATION_BACKUP_PATH;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const candidate = path.resolve(requested || path.join(root, `${target.database}-${timestamp}.dump`));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new MigrationSafetyError('backup path must remain below artifacts/migration-backups');
  }
  return candidate;
}

function main() {
  loadEnvironment();
  const execute = process.argv.includes('--execute');
  let state = STATES.IDLE;
  const target = validateTarget(process.env, { requireExecutionArm: execute });
  state = transition(state, STATES.TARGET_VALIDATED);
  const inspection = inspectMigrations(path.join(process.cwd(), 'backend', 'src', 'migrations'));
  const plan = verifyExpandOnly({ entries: inspection.entries, applied: [] });
  state = transition(state, STATES.PLAN_VERIFIED);
  const backupPath = backupPathFor(target);
  const command = commandForBackup(target, backupPath);
  state = transition(state, STATES.BACKUP_PLANNED);

  if (!execute) {
    console.log(JSON.stringify(receipt({ operation: 'backup', state, target, migrationPlan: plan, backupPath }), null, 2));
    console.log('[MIGRATE GUARD 03] PLAN ONLY. No database command was run; pass --execute and explicitly arm an isolated target to create a backup.');
    return;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  verifyTargetIdentity(target);
  run(command, target);
  run({ command: 'pg_restore', args: ['--list', backupPath] }, target);
  state = transition(state, STATES.BACKUP_VERIFIED);
  const value = receipt({ operation: 'backup', state, target, migrationPlan: plan, backupPath, checksum: sha256File(backupPath), executed: true });
  writeReceipt(`${backupPath}.receipt.json`, value);
  console.log(JSON.stringify(value, null, 2));
  console.log('[MIGRATE GUARD 03] PASS backup checksum and pg_restore readability receipt written');
}

try {
  main();
} catch (error) {
  const detail = error instanceof MigrationSafetyError ? error.message : 'backup guard failed';
  console.error('[MIGRATE GUARD 03] FAIL: %s', detail);
  process.exitCode = 1;
}
