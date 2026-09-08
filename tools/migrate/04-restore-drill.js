const fs = require('node:fs');
const path = require('node:path');
const {
  commandForRestore,
  receipt,
  run,
  transition,
  validateTarget,
  verifyTargetIdentity,
  writeReceipt,
  STATES,
  MigrationSafetyError,
} = require('./lib/migration-safety');

function main() {
  const dotenvPath = path.join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) require('dotenv').config({ path: dotenvPath });
  const execute = process.argv.includes('--execute');
  const target = validateTarget(process.env, { requireExecutionArm: execute });
  const backupPath = process.env.BOOKING_MIGRATION_BACKUP_PATH;
  const drillDatabase = process.env.BOOKING_RESTORE_DRILL_DATABASE;
  if (!backupPath || !drillDatabase) throw new MigrationSafetyError('BOOKING_MIGRATION_BACKUP_PATH and BOOKING_RESTORE_DRILL_DATABASE are required');
  const resolvedBackup = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackup)) throw new MigrationSafetyError('backup file does not exist');
  let state = transition(STATES.IDLE, STATES.TARGET_VALIDATED);
  state = transition(state, STATES.PLAN_VERIFIED);
  state = transition(state, STATES.BACKUP_PLANNED);
  state = transition(state, STATES.BACKUP_VERIFIED);
  const command = commandForRestore(target, resolvedBackup, drillDatabase);
  state = transition(state, STATES.RESTORE_PLANNED);
  if (!execute) {
    console.log(JSON.stringify(receipt({ operation: 'restore-drill', state, target, backupPath: resolvedBackup, restoreDatabase: drillDatabase }), null, 2));
    console.log('[MIGRATE RESTORE DRILL] PLAN ONLY. No restore command was run.');
    return;
  }
  verifyTargetIdentity(target);
  run({ command: 'pg_restore', args: ['--list', resolvedBackup] }, target);
  run(command, target);
  state = transition(state, STATES.RESTORE_VERIFIED);
  const value = receipt({ operation: 'restore-drill', state, target, backupPath: resolvedBackup, restoreDatabase: drillDatabase, executed: true });
  writeReceipt(`${resolvedBackup}.restore-drill.receipt.json`, value);
  console.log(JSON.stringify(value, null, 2));
  console.log('[MIGRATE RESTORE DRILL] PASS restore command receipt written');
}

try {
  main();
} catch (error) {
  const detail = error instanceof MigrationSafetyError ? error.message : 'restore drill failed';
  console.error('[MIGRATE RESTORE DRILL] FAIL: %s', detail);
  process.exitCode = 1;
}
