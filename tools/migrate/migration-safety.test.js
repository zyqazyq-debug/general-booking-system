const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  EXECUTION_ACKNOWLEDGEMENT,
  MigrationSafetyError,
  STATES,
  commandForBackup,
  commandForRestore,
  inspectMigrations,
  receipt,
  run,
  transition,
  validateTarget,
  verifyTargetIdentity,
  verifyExpandOnly,
} = require('./lib/migration-safety');

function isolatedEnvironment(overrides = {}) {
  return {
    BOOKING_MIGRATION_TARGET: 'isolated',
    NODE_ENV: 'test',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'booking_test_runner',
    POSTGRES_DB: 'booking_test_guard',
    POSTGRES_PASSWORD: 'not-for-output',
    ...overrides,
  };
}

test('target validation is fail-closed for production markers, non-loopback hosts, and missing execution arm', () => {
  assert.throws(() => validateTarget({}), MigrationSafetyError);
  assert.throws(() => validateTarget(isolatedEnvironment({ POSTGRES_HOST: '192.168.3.5' })), /loopback/);
  assert.throws(() => validateTarget(isolatedEnvironment({ POSTGRES_DB: 'booking_prod_guard' })), /booking_isolated/);
  assert.throws(() => validateTarget(isolatedEnvironment(), { requireExecutionArm: true }), /BOOKING_MIGRATION_EXECUTE/);
  assert.doesNotThrow(() => validateTarget(isolatedEnvironment({ BOOKING_MIGRATION_EXECUTE: EXECUTION_ACKNOWLEDGEMENT }), { requireExecutionArm: true }));
});

test('migration inspection uses source head and rejects destructive pending SQL', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-migration-'));
  try {
    fs.writeFileSync(path.join(temporary, '1770000000000-AddWidget.ts'), `export class AddWidget1770000000000 {\n public async up(): Promise<void> { await queryRunner.query(\`CREATE TABLE widget (id uuid)\`); }\n public async down(): Promise<void> {}\n}`);
    fs.writeFileSync(path.join(temporary, '1770000000001-DropWidget.ts'), `export class DropWidget1770000000001 {\n public async up(): Promise<void> { if (true) { await queryRunner.query(\`DROP TABLE widget\`); } }\n}`);
    const inspection = inspectMigrations(temporary);
    assert.equal(inspection.head, 'DropWidget1770000000001');
    assert.throws(() => verifyExpandOnly({ entries: inspection.entries, applied: ['AddWidget1770000000000'] }), /not expand-only/);
    const compatible = verifyExpandOnly({ entries: inspection.entries, applied: inspection.entries.map((entry) => entry.name) });
    assert.deepEqual(compatible.pending, []);
    assert.deepEqual(compatible.migrationsWithDownMethods, ['AddWidget1770000000000']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('backup and restore commands are argument arrays and restore cannot target source database', () => {
  const target = validateTarget(isolatedEnvironment());
  const backup = commandForBackup(target, path.join('artifacts', 'migration-backups', 'fixture.dump'));
  assert.equal(backup.command, 'pg_dump');
  assert.equal(backup.args.includes('not-for-output'), false);
  assert.throws(() => commandForRestore(target, 'fixture.dump', target.database), /must differ/);
  const restore = commandForRestore(target, 'fixture.dump', 'booking_restore_test_guard');
  assert.equal(restore.command, 'pg_restore');
  assert.ok(restore.args.includes('--clean'));
});

test('mock command execution never requires a real database and receipts omit credentials', () => {
  const target = validateTarget(isolatedEnvironment());
  const seen = [];
  run(commandForBackup(target, 'fixture.dump'), target, (command, args, options) => {
    seen.push({ command, args, password: options.env.PGPASSWORD });
    return { status: 0, stdout: '' };
  });
  assert.equal(seen[0].command, 'pg_dump');
  assert.equal(seen[0].password, 'not-for-output');
  const value = receipt({ operation: 'backup', state: STATES.BACKUP_PLANNED, target, backupPath: 'fixture.dump' });
  assert.equal(JSON.stringify(value).includes('not-for-output'), false);
  assert.equal(JSON.stringify(value).includes(target.username), false);
});

test('connected target identity must echo the explicit isolated database and role', () => {
  const target = validateTarget(isolatedEnvironment());
  const identity = verifyTargetIdentity(target, () => ({ status: 0, stdout: `${target.database}|${target.username}\n` }));
  assert.equal(identity.database, target.database);
  assert.throws(
    () => verifyTargetIdentity(target, () => ({ status: 0, stdout: 'booking_test_guard|some_other_role\n' })),
    /identity does not match/,
  );
});

test('state machine permits only forward backup and restore evidence transitions', () => {
  let state = STATES.IDLE;
  state = transition(state, STATES.TARGET_VALIDATED);
  state = transition(state, STATES.PLAN_VERIFIED);
  state = transition(state, STATES.BACKUP_PLANNED);
  state = transition(state, STATES.BACKUP_VERIFIED);
  state = transition(state, STATES.RESTORE_PLANNED);
  assert.equal(transition(state, STATES.RESTORE_VERIFIED), STATES.RESTORE_VERIFIED);
  assert.throws(() => transition(STATES.RESTORE_VERIFIED, STATES.BACKUP_PLANNED), /not allowed/);
});
