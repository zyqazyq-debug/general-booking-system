import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { DataSource } from 'typeorm';
import { resolveFileSecrets } from '../config/file-secrets';

type EnvMap = Record<string, unknown>;
type ReleaseEnvironment = 'preproduction' | 'production';
type MigrationCatalogEntry = {
  migration: string;
  className: string;
  digest: string;
  destructive: boolean;
};
export type MigrationCatalog = {
  entries: MigrationCatalogEntry[];
  expandFloor: string;
  catalogDigest: string;
};
type MigrationGuard = {
  env: EnvMap;
  environment: ReleaseEnvironment;
  database: string;
  approvedPending: string[];
  expectedCatalogDigest: string;
  expectedFloor: string;
  backupReceiptDigest: string;
  catalogDirectory: string;
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const MIGRATION_FILE = /^[0-9]{10,}-[A-Za-z0-9][A-Za-z0-9-]*\.ts$/;
const read = (env: EnvMap, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';
const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as EnvMap)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

function extractUpBody(source: string): string {
  const match = /(?:public\s+)?async\s+up\s*\(/.exec(source);
  if (!match) throw new Error('migration is missing up()');
  const start = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = start; index >= 0 && index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start + 1, index);
  }
  throw new Error('migration up() cannot be parsed');
}

function isDestructiveUp(source: string): boolean {
  const up = extractUpBody(source);
  const sql = [
    ...up.matchAll(/queryRunner\.query\s*\(\s*([`'"])([\s\S]*?)\1\s*,?\s*\)/g),
  ].map((item) => item[2]);
  const queryCalls = [...up.matchAll(/\bqueryRunner\.query\s*\(/g)];
  if (sql.length !== queryCalls.length) return true;
  if (
    /queryRunner\.(dropTable|dropColumn|dropIndex|clear|renameTable|renameColumn|changeColumn)\s*\(/i.test(
      up,
    )
  ) {
    return true;
  }
  return sql.some((statement) =>
    /\b(DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b[\s\S]*\b(DROP|RENAME|ALTER\s+COLUMN|SET\s+NOT\s+NULL)\b/i.test(
      statement,
    ),
  );
}

export function inspectMigrationCatalog(directory: string): MigrationCatalog {
  if (!isAbsolute(directory))
    throw new Error('migration catalog path must be absolute');
  const files = readdirSync(directory)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();
  if (!files.length) throw new Error('migration catalog is empty');
  const entries = files.map((file) => {
    const source = readFileSync(join(directory, file), 'utf8');
    const className = /export\s+class\s+([A-Za-z0-9_]+)/.exec(source)?.[1];
    if (!className) throw new Error('migration class cannot be identified');
    return {
      migration: basename(file, '.ts'),
      className,
      digest: sha256(source),
      destructive: isDestructiveUp(source),
    };
  });
  const digestInput = entries.map(({ migration, digest }) => ({
    migration,
    digest,
  }));
  return {
    entries,
    expandFloor: entries.at(-1)!.migration,
    catalogDigest: sha256(canonicalJson(digestInput)),
  };
}

export function migrationCatalogThrough(
  catalog: MigrationCatalog,
  floor: string,
): MigrationCatalog {
  const index = catalog.entries.findIndex((entry) => entry.migration === floor);
  if (index < 0) throw new Error('baseline migration floor is not in catalog');
  const entries = catalog.entries.slice(0, index + 1);
  const digestInput = entries.map(({ migration, digest }) => ({
    migration,
    digest,
  }));
  return {
    entries,
    expandFloor: floor,
    catalogDigest: sha256(canonicalJson(digestInput)),
  };
}

type BackupReceipt = {
  schema: string;
  environment: string;
  database: string;
  databaseUser: string;
  releaseId: string;
  gitSha: string;
  manifestDigest: string;
  manifestDigestMode: 'canonical-json' | 'raw-bytes';
  migrationCatalogDigest: string;
  backupDigest: string;
  deploymentBinding: Record<string, unknown>;
  verifiedAt: string;
  verification: { pgRestoreList: boolean };
};

export function validateBackupReceipt(
  value: unknown,
  expected: {
    environment: ReleaseEnvironment;
    database: string;
    releaseId: string;
    gitSha: string;
    manifestDigest: string;
    migrationCatalogDigest: string;
    manifestDigestMode: 'canonical-json' | 'raw-bytes';
  },
): BackupReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('backup receipt is invalid');
  }
  const receipt = value as BackupReceipt;
  const keys = Object.keys(receipt).sort();
  const expectedKeys = [
    'backupDigest',
    'database',
    'databaseUser',
    'deploymentBinding',
    'environment',
    'gitSha',
    'manifestDigest',
    'manifestDigestMode',
    'migrationCatalogDigest',
    'releaseId',
    'schema',
    'verification',
    'verifiedAt',
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)) {
    throw new Error('backup receipt fields are invalid');
  }
  if (
    receipt.schema !== 'booking.database-backup-receipt/v1' ||
    receipt.environment !== expected.environment ||
    receipt.database !== expected.database ||
    receipt.databaseUser !== expected.database ||
    receipt.releaseId !== expected.releaseId ||
    receipt.gitSha !== expected.gitSha ||
    receipt.manifestDigest !== expected.manifestDigest ||
    receipt.manifestDigestMode !== expected.manifestDigestMode ||
    receipt.migrationCatalogDigest !== expected.migrationCatalogDigest ||
    !DIGEST.test(receipt.backupDigest) ||
    !receipt.deploymentBinding ||
    canonicalJson(Object.keys(receipt.deploymentBinding).sort()) !==
      canonicalJson(
        [
          'approvalId',
          'currentManifestDigest',
          'environment',
          'fencingEpoch',
          'generation',
          'holderId',
          'leaseId',
          'operationId',
          'project',
        ].sort(),
      ) ||
    receipt.deploymentBinding.environment !== 'preprod' ||
    receipt.deploymentBinding.project !== 'booking-preprod' ||
    !Number.isInteger(receipt.deploymentBinding.generation) ||
    Number(receipt.deploymentBinding.generation) < 1 ||
    !Number.isInteger(receipt.deploymentBinding.fencingEpoch) ||
    Number(receipt.deploymentBinding.fencingEpoch) < 1 ||
    !DIGEST.test(
      String(receipt.deploymentBinding.currentManifestDigest || ''),
    ) ||
    ['operationId', 'approvalId', 'leaseId', 'holderId'].some(
      (key) =>
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
          String(receipt.deploymentBinding[key] || ''),
        ),
    ) ||
    !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
    !receipt.verification ||
    Object.keys(receipt.verification).length !== 1 ||
    receipt.verification.pgRestoreList !== true
  ) {
    throw new Error('backup receipt binding is invalid');
  }
  return receipt;
}

function parseApprovedPending(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('approved pending migration allowlist must be JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) => typeof item !== 'string' || !/^[A-Za-z0-9_]+$/.test(item),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('approved pending migration allowlist is invalid');
  }
  return parsed;
}

export function validateMigrationEnvironment(input: EnvMap): MigrationGuard {
  const env = resolveFileSecrets(input);
  if (read(env, 'BOOKING_SCHEMA_MIGRATE') !== 'true') {
    throw new Error('BOOKING_SCHEMA_MIGRATE=true is required');
  }
  const environment = read(env, 'NODE_ENV');
  if (!['production', 'preproduction'].includes(environment)) {
    throw new Error('migration runtime must be production or preproduction');
  }
  if (read(env, 'BOOKING_MIGRATION_ENVIRONMENT') !== environment) {
    throw new Error('migration target environment acknowledgement mismatch');
  }
  if (read(env, 'USE_POSTGRES') !== 'true') {
    throw new Error('migration runtime requires PostgreSQL');
  }
  if (read(env, 'TYPEORM_SYNCHRONIZE') === 'true') {
    throw new Error('TYPEORM_SYNCHRONIZE must remain false');
  }
  const database = read(env, 'POSTGRES_DB');
  if (
    !database ||
    database !== read(env, 'BOOKING_MIGRATION_EXPECTED_DATABASE')
  ) {
    throw new Error('migration target database acknowledgement mismatch');
  }
  for (const key of ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
    if (!read(env, key)) throw new Error(`${key} is required`);
  }
  if (!RELEASE_ID.test(read(env, 'BOOKING_RELEASE_ID'))) {
    throw new Error('BOOKING_RELEASE_ID is invalid');
  }
  if (!GIT_SHA.test(read(env, 'BOOKING_GIT_SHA'))) {
    throw new Error('BOOKING_GIT_SHA is invalid');
  }
  for (const key of [
    'BOOKING_MANIFEST_DIGEST',
    'BOOKING_MIGRATION_CATALOG_DIGEST',
    'BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST',
  ]) {
    if (!DIGEST.test(read(env, key))) throw new Error(`${key} is invalid`);
  }
  const receiptPath = read(env, 'BOOKING_MIGRATION_BACKUP_RECEIPT_FILE');
  const catalogDirectory = read(env, 'BOOKING_MIGRATION_CATALOG_DIR');
  if (!isAbsolute(receiptPath))
    throw new Error('backup receipt path must be absolute');
  if (!isAbsolute(catalogDirectory))
    throw new Error('migration catalog path must be absolute');
  if (
    !MIGRATION_FILE.test(`${read(env, 'BOOKING_MIGRATION_EXPECTED_FLOOR')}.ts`)
  ) {
    throw new Error('BOOKING_MIGRATION_EXPECTED_FLOOR is invalid');
  }
  return {
    env,
    environment: environment as ReleaseEnvironment,
    database,
    approvedPending: parseApprovedPending(
      read(env, 'BOOKING_MIGRATION_APPROVED_PENDING_JSON'),
    ),
    expectedCatalogDigest: read(env, 'BOOKING_MIGRATION_CATALOG_DIGEST'),
    expectedFloor: read(env, 'BOOKING_MIGRATION_EXPECTED_FLOOR'),
    backupReceiptDigest: read(env, 'BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST'),
    catalogDirectory,
  };
}

function verifyBackupReceiptFile(guard: MigrationGuard) {
  const path = read(guard.env, 'BOOKING_MIGRATION_BACKUP_RECEIPT_FILE');
  const stats = statSync(path);
  if (!stats.isFile() || stats.size <= 0 || stats.size > 64 * 1024) {
    throw new Error('backup receipt file is invalid');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== guard.backupReceiptDigest) {
    throw new Error('backup receipt digest mismatch');
  }
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('backup receipt JSON is invalid');
  }
  const receipt = validateBackupReceipt(document, {
    environment: guard.environment,
    database: guard.database,
    releaseId: read(guard.env, 'BOOKING_RELEASE_ID'),
    gitSha: read(guard.env, 'BOOKING_GIT_SHA'),
    manifestDigest: read(guard.env, 'BOOKING_MANIFEST_DIGEST'),
    migrationCatalogDigest: guard.expectedCatalogDigest,
    manifestDigestMode: 'canonical-json',
  });
  const ageMs = Date.now() - Date.parse(receipt.verifiedAt);
  if (ageMs < 0 || ageMs > 60 * 60 * 1000) {
    throw new Error('backup receipt is stale or future-dated');
  }
  return receipt;
}

export function verifyMigrationPlan(
  catalog: MigrationCatalog,
  applied: string[],
  approvedPending: string[],
) {
  const catalogNames = catalog.entries.map((entry) => entry.className);
  const unknownApplied = applied.filter((name) => !catalogNames.includes(name));
  if (unknownApplied.length)
    throw new Error('database contains unknown migrations');
  if (
    canonicalJson(applied) !==
    canonicalJson(catalogNames.slice(0, applied.length))
  ) {
    throw new Error('database migration ledger is not a catalog prefix');
  }
  const actualPending = catalogNames.filter((name) => !applied.includes(name));
  const exactPlan =
    canonicalJson(actualPending) === canonicalJson(approvedPending);
  const safeCompletedReplay =
    actualPending.length === 0 &&
    approvedPending.length > 0 &&
    canonicalJson(approvedPending) ===
      canonicalJson(catalogNames.slice(-approvedPending.length));
  if (!exactPlan && !safeCompletedReplay) {
    throw new Error('pending migrations do not match approved exact allowlist');
  }
  if (
    catalog.entries.some(
      (entry) => actualPending.includes(entry.className) && entry.destructive,
    )
  ) {
    throw new Error('destructive pending migrations are forbidden');
  }
  return actualPending;
}

async function readAppliedMigrations(
  dataSource: DataSource,
): Promise<string[]> {
  try {
    const rows = await dataSource.query(
      'SELECT "name" FROM "migrations" ORDER BY "timestamp" ASC, "id" ASC',
    );
    if (rows.some((row) => typeof row.name !== 'string')) throw new Error();
    return rows.map((row) => row.name);
  } catch {
    throw new Error('database migration ledger is missing or unreadable');
  }
}

type ShapeObject =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; name: string }
  | { kind: 'index'; name: string }
  | { kind: 'constraint'; table: string; name: string };

const columns = (table: string, names: string[]): ShapeObject[] =>
  names.map((name) => ({ kind: 'column', table, name }));

const SHAPE_PREFLIGHT: Record<string, ShapeObject[]> = {
  CreateTelegramWebhookInbox1788730000000: [
    { kind: 'table', table: 'telegram_webhook_updates' },
    ...columns('telegram_webhook_updates', [
      'update_id',
      'status',
      'claim_token',
      'lease_expires_at',
      'processed_at',
      'received_at',
      'updated_at',
    ]),
    { kind: 'table', table: 'telegram_webhook_operations' },
    ...columns('telegram_webhook_operations', [
      'idempotency_key',
      'update_id',
      'operation',
      'resource_hash',
      'status',
      'result_payload',
      'created_at',
      'updated_at',
    ]),
    { kind: 'table', table: 'telegram_binding_tickets' },
    ...columns('telegram_binding_tickets', [
      'token_hash',
      'kind',
      'user_id',
      'status',
      'result_payload',
      'expires_at',
      'created_at',
      'updated_at',
    ]),
    { kind: 'index', name: 'IDX_telegram_webhook_updates_processing_lease' },
    { kind: 'index', name: 'IDX_telegram_webhook_operations_update' },
    {
      kind: 'constraint',
      table: 'telegram_webhook_updates',
      name: 'CHK_telegram_webhook_updates_status',
    },
    {
      kind: 'constraint',
      table: 'telegram_webhook_operations',
      name: 'CHK_telegram_webhook_operations_status',
    },
    {
      kind: 'constraint',
      table: 'telegram_binding_tickets',
      name: 'CHK_telegram_binding_tickets_kind',
    },
    {
      kind: 'constraint',
      table: 'telegram_binding_tickets',
      name: 'CHK_telegram_binding_tickets_status',
    },
  ],
  AddOrderSourceIdempotencyKey1788740000000: [
    { kind: 'column', table: 'orders', name: 'source_idempotency_key' },
    { kind: 'index', name: 'uq_orders_source_idempotency_key' },
  ],
  CreateOrderOutbox1788750000000: [
    { kind: 'table', table: 'order_outbox_events' },
    ...columns('order_outbox_events', [
      'id',
      'aggregate_id',
      'event_type',
      'idempotency_key',
      'payload',
      'status',
      'attempts',
      'claim_token',
      'lease_expires_at',
      'available_at',
      'processed_at',
      'last_error',
      'created_at',
      'updated_at',
    ]),
    { kind: 'index', name: 'idx_order_outbox_dispatch' },
    { kind: 'index', name: 'idx_order_outbox_processing_lease' },
    { kind: 'index', name: 'idx_order_outbox_aggregate' },
    {
      kind: 'constraint',
      table: 'order_outbox_events',
      name: 'uq_order_outbox_idempotency_key',
    },
    {
      kind: 'constraint',
      table: 'order_outbox_events',
      name: 'chk_order_outbox_status',
    },
  ],
  AddOrderCreatedConsumerIdempotency1788760000000: [
    { kind: 'table', table: 'agency_order_event_consumptions' },
    ...columns('agency_order_event_consumptions', ['event_id', 'processed_at']),
    { kind: 'table', table: 'order_notification_deliveries' },
    ...columns('order_notification_deliveries', [
      'id',
      'event_id',
      'recipient_id',
      'status',
      'claim_token',
      'lease_expires_at',
      'sent_at',
      'provider_message_id',
      'last_error_type',
      'created_at',
      'updated_at',
    ]),
    { kind: 'index', name: 'idx_order_notification_status_lease' },
    {
      kind: 'constraint',
      table: 'agency_order_event_consumptions',
      name: 'pk_agency_order_event_consumptions',
    },
    {
      kind: 'constraint',
      table: 'order_notification_deliveries',
      name: 'pk_order_notification_deliveries',
    },
    {
      kind: 'constraint',
      table: 'order_notification_deliveries',
      name: 'uq_order_notification_event_recipient',
    },
    {
      kind: 'constraint',
      table: 'order_notification_deliveries',
      name: 'chk_order_notification_delivery_status',
    },
    {
      kind: 'constraint',
      table: 'order_notification_deliveries',
      name: 'chk_order_notification_delivery_receipt',
    },
  ],
};

async function shapeObjectExists(dataSource: DataSource, object: ShapeObject) {
  let sql: string;
  let values: string[];
  if (object.kind === 'table') {
    sql = "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists";
    values = [object.table];
  } else if (object.kind === 'column') {
    sql =
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS exists";
    values = [object.table, object.name];
  } else if (object.kind === 'index') {
    sql =
      "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1) AS exists";
    values = [object.name];
  } else {
    sql =
      "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = $1 AND c.conname = $2) AS exists";
    values = [object.table, object.name];
  }
  const rows = await dataSource.query(sql, values);
  if (typeof rows[0]?.exists !== 'boolean') {
    throw new Error('migration shape preflight returned an invalid result');
  }
  return rows[0].exists;
}

export async function verifyPendingMigrationShapes(
  dataSource: DataSource,
  pending: string[],
) {
  for (const migration of pending) {
    const objects = SHAPE_PREFLIGHT[migration];
    if (!objects) {
      throw new Error('pending migration has no approved shape preflight');
    }
    for (const object of objects) {
      if (await shapeObjectExists(dataSource, object)) {
        throw new Error('pending migration target shape is not pristine');
      }
    }
  }
}

export function verifyCompletedMigrationLedger(
  catalog: MigrationCatalog,
  applied: string[],
) {
  const expected = catalog.entries.map((entry) => entry.className);
  if (canonicalJson(applied) !== canonicalJson(expected)) {
    throw new Error('database migration ledger does not exactly match catalog');
  }
  return {
    migrationCount: applied.length,
    ledgerHead: applied.at(-1) || null,
    ledgerDigest: sha256(canonicalJson(applied)),
  };
}

export async function readBackMigrations(input: EnvMap = process.env) {
  const guard = validateMigrationEnvironment(input);
  const catalog = inspectMigrationCatalog(guard.catalogDirectory);
  if (
    catalog.catalogDigest !== guard.expectedCatalogDigest ||
    catalog.expandFloor !== guard.expectedFloor
  ) {
    throw new Error('migration readback catalog identity mismatch');
  }
  verifyBackupReceiptFile(guard);
  for (const [key, value] of Object.entries(guard.env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
  const { default: dataSource } = await import('../../data-source');
  await dataSource.initialize();
  try {
    const ledger = verifyCompletedMigrationLedger(
      catalog,
      await readAppliedMigrations(dataSource),
    );
    const receipt = {
      schema: 'booking.migration-readback/v1',
      environment: guard.environment,
      database: guard.database,
      releaseId: read(guard.env, 'BOOKING_RELEASE_ID'),
      gitSha: read(guard.env, 'BOOKING_GIT_SHA'),
      manifestDigest: read(guard.env, 'BOOKING_MANIFEST_DIGEST'),
      migrationCatalogDigest: catalog.catalogDigest,
      migrationFloor: catalog.expandFloor,
      backupReceiptDigest: guard.backupReceiptDigest,
      ...ledger,
      verifiedAt: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    await dataSource.destroy();
  }
}

export async function runMigrations(input: EnvMap = process.env) {
  const guard = validateMigrationEnvironment(input);
  const catalog = inspectMigrationCatalog(guard.catalogDirectory);
  if (catalog.catalogDigest !== guard.expectedCatalogDigest) {
    throw new Error('migration catalog digest mismatch');
  }
  if (catalog.expandFloor !== guard.expectedFloor) {
    throw new Error('migration floor mismatch');
  }
  verifyBackupReceiptFile(guard);
  for (const [key, value] of Object.entries(guard.env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
  const { default: dataSource } = await import('../../data-source');
  await dataSource.initialize();
  try {
    const pending = verifyMigrationPlan(
      catalog,
      await readAppliedMigrations(dataSource),
      guard.approvedPending,
    );
    await verifyPendingMigrationShapes(dataSource, pending);
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    if (
      canonicalJson(applied.map((item) => item.name)) !== canonicalJson(pending)
    ) {
      throw new Error('applied migrations differ from approved plan');
    }
    const receipt = {
      schema: 'booking.migration-apply-receipt/v1',
      environment: guard.environment,
      database: guard.database,
      releaseId: read(guard.env, 'BOOKING_RELEASE_ID'),
      gitSha: read(guard.env, 'BOOKING_GIT_SHA'),
      manifestDigest: read(guard.env, 'BOOKING_MANIFEST_DIGEST'),
      migrationCatalogDigest: catalog.catalogDigest,
      migrationFloor: catalog.expandFloor,
      approvedPending: pending,
      backupReceiptDigest: guard.backupReceiptDigest,
      completedAt: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return applied;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  const action = process.argv.slice(2);
  const operation =
    action.length === 0
      ? runMigrations()
      : action.length === 1 && action[0] === '--action=verify'
        ? readBackMigrations()
        : Promise.reject(new Error('invalid migration action'));
  void operation.catch(() => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: 'BOOKING_MIGRATIONS_FAILED' })}\n`,
    );
    process.exitCode = 1;
  });
}
