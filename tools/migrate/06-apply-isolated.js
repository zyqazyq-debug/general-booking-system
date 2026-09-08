const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  commandForBackup,
  inspectMigrations,
  readAppliedMigrations,
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

function backupPathFor(target) {
  const root = path.resolve(process.cwd(), 'artifacts', 'migration-backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(root, `${target.database}-${timestamp}.before-migrate.dump`);
}

function main() {
  if (!process.argv.includes('--execute')) {
    throw new MigrationSafetyError('migration application is plan-denied by default; pass --execute with the isolated execution acknowledgement');
  }
  const dotenvPath = path.join(process.cwd(), 'backend', '.env');
  if (fs.existsSync(dotenvPath)) require('dotenv').config({ path: dotenvPath });
  let state = STATES.IDLE;
  const target = validateTarget(process.env, { requireExecutionArm: true });
  state = transition(state, STATES.TARGET_VALIDATED);
  verifyTargetIdentity(target);
  const inspection = inspectMigrations(path.join(process.cwd(), 'backend', 'src', 'migrations'));
  const applied = readAppliedMigrations(target);
  const plan = verifyExpandOnly({ entries: inspection.entries, applied });
  state = transition(state, STATES.PLAN_VERIFIED);
  const backupPath = backupPathFor(target);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  state = transition(state, STATES.BACKUP_PLANNED);
  run(commandForBackup(target, backupPath), target);
  run({ command: 'pg_restore', args: ['--list', backupPath] }, target);
  state = transition(state, STATES.BACKUP_VERIFIED);
  const migrate = spawnSync('npm', ['run', 'typeorm', '--', '-d', './data-source.ts', 'migration:run'], {
    cwd: path.join(process.cwd(), 'backend'),
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  });
  if (migrate.error || migrate.status !== 0) throw new MigrationSafetyError('TypeORM migration failed; the pre-migration backup receipt remains available');
  state = transition(state, STATES.MIGRATION_APPLIED);
  const value = receipt({ operation: 'apply-isolated', state, target, migrationPlan: plan, backupPath, checksum: sha256File(backupPath), executed: true });
  writeReceipt(`${backupPath}.apply.receipt.json`, value);
  console.log(JSON.stringify(value, null, 2));
  console.log('[MIGRATE APPLY] PASS isolated migration applied; automatic revert remains forbidden');
}

try {
  main();
} catch (error) {
  const detail = error instanceof MigrationSafetyError ? error.message : 'isolated migration application failed';
  console.error('[MIGRATE APPLY] FAIL: %s', detail);
  process.exitCode = 1;
}
