const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXECUTION_ACKNOWLEDGEMENT = 'isolated-db-only';
const TARGET_KIND = 'isolated';
const MIGRATION_TABLE = 'migrations';
const STATES = Object.freeze({
  IDLE: 'IDLE',
  TARGET_VALIDATED: 'TARGET_VALIDATED',
  PLAN_VERIFIED: 'PLAN_VERIFIED',
  BACKUP_PLANNED: 'BACKUP_PLANNED',
  BACKUP_VERIFIED: 'BACKUP_VERIFIED',
  RESTORE_PLANNED: 'RESTORE_PLANNED',
  RESTORE_VERIFIED: 'RESTORE_VERIFIED',
  MIGRATION_APPLIED: 'MIGRATION_APPLIED',
  FAILED: 'FAILED',
});

const TRANSITIONS = Object.freeze({
  [STATES.IDLE]: [STATES.TARGET_VALIDATED, STATES.FAILED],
  [STATES.TARGET_VALIDATED]: [STATES.PLAN_VERIFIED, STATES.FAILED],
  [STATES.PLAN_VERIFIED]: [STATES.BACKUP_PLANNED, STATES.FAILED],
  [STATES.BACKUP_PLANNED]: [STATES.BACKUP_VERIFIED, STATES.FAILED],
  [STATES.BACKUP_VERIFIED]: [STATES.RESTORE_PLANNED, STATES.MIGRATION_APPLIED, STATES.FAILED],
  [STATES.RESTORE_PLANNED]: [STATES.RESTORE_VERIFIED, STATES.FAILED],
  [STATES.RESTORE_VERIFIED]: [STATES.MIGRATION_APPLIED, STATES.FAILED],
  [STATES.MIGRATION_APPLIED]: [],
  [STATES.FAILED]: [],
});

class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationSafetyError';
  }
}

function valueFrom(env, preferred, legacy) {
  const preferredValue = env[preferred];
  const legacyValue = env[legacy];
  if (preferredValue && legacyValue && preferredValue !== legacyValue) {
    throw new MigrationSafetyError(`${preferred} and ${legacy} disagree`);
  }
  return preferredValue || legacyValue || '';
}

function isLoopbackHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host).toLowerCase());
}

function containsProtectedWord(value) {
  return /(?:^|[-_.])(prod(?:uction)?|preprod|staging|release|nas)(?:$|[-_.])/i.test(value);
}

function readPassword(env) {
  const password = valueFrom(env, 'POSTGRES_PASSWORD', 'DB_PASSWORD');
  const file = valueFrom(env, 'POSTGRES_PASSWORD_FILE', 'DB_PASSWORD_FILE');
  if (password && file) throw new MigrationSafetyError('database password and password file cannot both be set');
  if (!file) return password;
  try {
    return fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
  } catch {
    throw new MigrationSafetyError('database password file is missing or unreadable');
  }
}

function targetFingerprint(target) {
  return `sha256:${crypto.createHash('sha256')
    .update(`${target.host}:${target.port}:${target.username}:${target.database}`)
    .digest('hex')}`;
}

function validateTarget(env = process.env, { requireExecutionArm = false } = {}) {
  if (env.BOOKING_MIGRATION_TARGET !== TARGET_KIND) {
    throw new MigrationSafetyError('BOOKING_MIGRATION_TARGET=isolated is required');
  }
  if (env.NODE_ENV === 'production') {
    throw new MigrationSafetyError('NODE_ENV=production is never an isolated migration target');
  }

  const host = valueFrom(env, 'POSTGRES_HOST', 'DB_HOST');
  const port = valueFrom(env, 'POSTGRES_PORT', 'DB_PORT') || '5432';
  const username = valueFrom(env, 'POSTGRES_USER', 'DB_USERNAME');
  const database = valueFrom(env, 'POSTGRES_DB', 'DB_DATABASE');
  if (!host || !username || !database) {
    throw new MigrationSafetyError('explicit POSTGRES_/DB_ host, user, and database inputs are required');
  }
  if (!isLoopbackHost(host)) {
    throw new MigrationSafetyError('isolated migrations may only use a loopback database host');
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new MigrationSafetyError('database port is invalid');
  }
  if (!/^booking_(?:isolated|local|dev|test|e2e)_[a-z0-9_]+$/i.test(database)) {
    throw new MigrationSafetyError('database must use a booking_isolated/local/dev/test/e2e_ name');
  }
  if (containsProtectedWord(`${host}.${username}.${database}`)) {
    throw new MigrationSafetyError('target identity contains a protected production or NAS marker');
  }
  if (requireExecutionArm && env.BOOKING_MIGRATION_EXECUTE !== EXECUTION_ACKNOWLEDGEMENT) {
    throw new MigrationSafetyError(`set BOOKING_MIGRATION_EXECUTE=${EXECUTION_ACKNOWLEDGEMENT} to execute against an isolated target`);
  }

  const target = { host, port: Number(port), username, database, password: readPassword(env) };
  return { ...target, fingerprint: targetFingerprint(target) };
}

function transition(state, next) {
  if (!TRANSITIONS[state] || !TRANSITIONS[state].includes(next)) {
    throw new MigrationSafetyError(`migration safety transition ${state} -> ${next} is not allowed`);
  }
  return next;
}

function extractMigrationEntry(file) {
  const source = fs.readFileSync(file, 'utf8');
  const fileName = path.basename(file);
  const match = /^(\d{13,17})-([A-Za-z0-9_-]+)\.ts$/.exec(fileName);
  if (!match) throw new MigrationSafetyError(`invalid migration filename: ${fileName}`);
  const classMatch = /export\s+class\s+([A-Za-z0-9_]+)/.exec(source);
  if (!classMatch) throw new MigrationSafetyError(`migration does not export a class: ${fileName}`);
  const method = /(?:public\s+)?async\s+up\s*\(/.exec(source);
  let upSource = '';
  if (method) {
    const start = source.indexOf('{', method.index);
    let depth = 0;
    for (let index = start; index >= 0 && index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      if (depth === 0) {
        upSource = source.slice(start + 1, index);
        break;
      }
    }
  }
  const queryCalls = [...upSource.matchAll(/\bqueryRunner\.query\s*\(/g)];
  const sql = [...upSource.matchAll(/queryRunner\.query\s*\(\s*([`'"])([\s\S]*?)\1\s*\)/g)].map((item) => item[2]);
  const destructive = sql.filter((statement) => (
    /\b(drop|truncate|delete|rename)\b|\balter\s+table\b[\s\S]*\b(drop|rename|alter\s+column|set\s+not\s+null)\b/i.test(statement)
  ));
  const unsafeApiCalls = [...upSource.matchAll(/queryRunner\.(dropTable|dropColumn|dropIndex|clear|renameTable|renameColumn|changeColumn)\s*\(/g)]
    .map((item) => `queryRunner.${item[1]}(...)`);
  if (queryCalls.length !== sql.length) destructive.push('non-literal queryRunner.query(...) requires explicit classification');
  destructive.push(...unsafeApiCalls);
  return {
    fileName,
    timestamp: match[1],
    name: classMatch[1],
    destructiveSql: destructive.map((statement) => statement.replace(/\s+/g, ' ').trim().slice(0, 160)),
    hasDown: /(?:public\s+)?async\s+down\s*\(/.test(source),
  };
}

function inspectMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) throw new MigrationSafetyError(`migrations directory does not exist: ${migrationsDir}`);
  const tmp = fs.readdirSync(migrationsDir).filter((file) => file.startsWith('tmp-'));
  if (tmp.length) throw new MigrationSafetyError(`temporary migration files found: ${tmp.join(', ')}`);
  const entries = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => extractMigrationEntry(path.join(migrationsDir, file)))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const duplicate = entries.find((entry, index) => index > 0 && entry.timestamp === entries[index - 1].timestamp);
  if (duplicate) throw new MigrationSafetyError(`duplicate migration timestamp: ${duplicate.timestamp}`);
  return { entries, head: entries.at(-1)?.name || null };
}

function verifyExpandOnly({ entries, applied = [] }) {
  const appliedSet = new Set(applied);
  const unknownApplied = applied.filter((name) => !entries.some((entry) => entry.name === name));
  if (unknownApplied.length) throw new MigrationSafetyError(`target migration table has unknown migrations: ${unknownApplied.join(', ')}`);
  const pending = entries.filter((entry) => !appliedSet.has(entry.name));
  const destructive = pending.filter((entry) => entry.destructiveSql.length > 0);
  if (destructive.length) {
    throw new MigrationSafetyError(`pending migrations are not expand-only: ${destructive.map((entry) => entry.fileName).join(', ')}`);
  }
  return {
    head: entries.at(-1)?.name || null,
    appliedHead: applied.length ? applied.at(-1) : null,
    pending: pending.map((entry) => entry.name),
    migrationsWithDownMethods: entries.filter((entry) => entry.hasDown).map((entry) => entry.name),
  };
}

function commandForBackup(target, backupPath) {
  return {
    command: 'pg_dump',
    args: ['--format=custom', '--no-owner', '--file', backupPath, '--host', target.host, '--port', String(target.port), '--username', target.username, target.database],
  };
}

function commandForRestore(target, backupPath, drillDatabase) {
  if (drillDatabase === target.database) throw new MigrationSafetyError('restore drill database must differ from the migration target');
  if (!/^booking_restore_(?:isolated|local|dev|test|e2e)_[a-z0-9_]+$/i.test(drillDatabase)) {
    throw new MigrationSafetyError('restore drill database must use a booking_restore_isolated/local/dev/test/e2e_ name');
  }
  return {
    command: 'pg_restore',
    args: ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--host', target.host, '--port', String(target.port), '--username', target.username, '--dbname', drillDatabase, backupPath],
  };
}

function commandForMigrationHead(target) {
  return {
    command: 'psql',
    args: [
      '--tuples-only', '--no-align', '--quiet', '--host', target.host, '--port', String(target.port),
      '--username', target.username, '--dbname', target.database,
      '--command', `SELECT "name" FROM "${MIGRATION_TABLE}" ORDER BY "id" ASC;`,
    ],
  };
}

function commandForTargetIdentity(target) {
  return {
    command: 'psql',
    args: [
      '--tuples-only', '--no-align', '--quiet', '--host', target.host, '--port', String(target.port),
      '--username', target.username, '--dbname', target.database,
      '--command', "SELECT current_database() || '|' || current_user;",
    ],
  };
}

function verifyTargetIdentity(target, spawn = spawnSync) {
  const result = run(commandForTargetIdentity(target), target, spawn);
  const observed = String(result.stdout || '').trim().split('|');
  if (observed.length !== 2 || observed[0] !== target.database || observed[1] !== target.username) {
    throw new MigrationSafetyError('connected database identity does not match the explicit isolated target');
  }
  return { database: observed[0], username: observed[1] };
}

function readAppliedMigrations(target, spawn = spawnSync) {
  const result = run(commandForMigrationHead(target), target, spawn);
  return String(result.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function run(command, target, spawn = spawnSync) {
  const result = spawn(command.command, command.args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(target.password ? { PGPASSWORD: target.password } : {}) },
  });
  if (result.error || result.status !== 0) {
    throw new MigrationSafetyError(`${command.command} failed without exposing command output`);
  }
  return result;
}

function sha256File(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function receipt({ operation, state, target, migrationPlan, backupPath, checksum = null, executed = false, restoreDatabase = null }) {
  return {
    schema: 'booking.migration-safety-receipt/v1',
    operation,
    state,
    executed,
    target: { kind: TARGET_KIND, fingerprint: target.fingerprint, database: target.database },
    migration: migrationPlan ? {
      head: migrationPlan.head,
      appliedHead: migrationPlan.appliedHead,
      pending: migrationPlan.pending,
      expandOnly: true,
      automaticRevert: 'forbidden',
    } : undefined,
    backup: backupPath ? { path: backupPath, checksum, readable: checksum !== null } : undefined,
    restoreDrill: restoreDatabase ? { database: restoreDatabase, cleanRestore: true } : undefined,
    recordedAt: new Date().toISOString(),
  };
}

function writeReceipt(receiptPath, value) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(receiptPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

module.exports = {
  EXECUTION_ACKNOWLEDGEMENT,
  MIGRATION_TABLE,
  STATES,
  TRANSITIONS,
  MigrationSafetyError,
  commandForBackup,
  commandForTargetIdentity,
  commandForMigrationHead,
  commandForRestore,
  inspectMigrations,
  receipt,
  readAppliedMigrations,
  run,
  sha256File,
  transition,
  validateTarget,
  verifyTargetIdentity,
  verifyExpandOnly,
  writeReceipt,
};
