import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { DataSource, QueryRunner } from 'typeorm';
import { resolveFileSecrets } from '../config/file-secrets';
import {
  inspectMigrationCatalog,
  migrationCatalogThrough,
  validateBackupReceipt,
  type MigrationCatalog,
} from './run-migrations';

type EnvMap = Record<string, unknown>;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_ID = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const FLOOR = /^[0-9]{10,}-[A-Za-z0-9][A-Za-z0-9-]*$/;

const read = (env: EnvMap, key: string): string =>
  typeof env[key] === 'string' ? env[key].trim() : '';
const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

type BaselineGuard = {
  env: EnvMap;
  releaseId: string;
  gitSha: string;
  manifestDigest: string;
  catalogDigest: string;
  floor: string;
  history: Array<{ timestamp: string; name: string }>;
  schemaDiffReceiptDigest: string;
  backupReceiptDigest: string;
  catalogDirectory: string;
};

function readReceipt(path: string, expectedDigest: string, label: string) {
  if (!isAbsolute(path))
    throw new Error(`${label} receipt path must be absolute`);
  const stats = statSync(path);
  if (!stats.isFile() || stats.size <= 0 || stats.size > 64 * 1024) {
    throw new Error(`${label} receipt file is invalid`);
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== expectedDigest) {
    throw new Error(`${label} receipt digest mismatch`);
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${label} receipt JSON is invalid`);
  }
}

function parseHistory(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('baseline history must be JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        Object.keys(item).sort().join(',') !== 'name,timestamp' ||
        typeof item.timestamp !== 'string' ||
        !/^\d{10,}$/.test(item.timestamp) ||
        typeof item.name !== 'string' ||
        !/^[A-Za-z0-9_]+$/.test(item.name) ||
        !item.name.endsWith(item.timestamp),
    )
  ) {
    throw new Error('baseline history is invalid');
  }
  return parsed as Array<{ timestamp: string; name: string }>;
}

export function validateBaselineEnvironment(input: EnvMap): BaselineGuard {
  const env = resolveFileSecrets(input);
  if (read(env, 'BOOKING_SCHEMA_BASELINE') !== 'true') {
    throw new Error('BOOKING_SCHEMA_BASELINE=true is required');
  }
  if (read(env, 'NODE_ENV') !== 'preproduction') {
    throw new Error('baseline is restricted to preproduction');
  }
  if (
    read(env, 'POSTGRES_HOST') !== 'postgres' ||
    read(env, 'POSTGRES_DB') !== 'booking_preprod' ||
    read(env, 'BOOKING_BASELINE_EXPECTED_DATABASE') !== 'booking_preprod'
  ) {
    throw new Error(
      'baseline target must be the isolated preproduction database',
    );
  }
  for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD']) {
    if (!read(env, key)) throw new Error(`${key} is required`);
  }
  const releaseId = read(env, 'BOOKING_BASELINE_OLD_RELEASE_ID');
  const gitSha = read(env, 'BOOKING_BASELINE_OLD_GIT_SHA');
  const manifestDigest = read(env, 'BOOKING_BASELINE_OLD_MANIFEST_DIGEST');
  const catalogDigest = read(env, 'BOOKING_BASELINE_OLD_CATALOG_DIGEST');
  const floor = read(env, 'BOOKING_BASELINE_OLD_FLOOR');
  if (!RELEASE_ID.test(releaseId)) throw new Error('old release ID is invalid');
  if (!GIT_SHA.test(gitSha)) throw new Error('old Git SHA is invalid');
  if (!DIGEST.test(manifestDigest) || !DIGEST.test(catalogDigest)) {
    throw new Error('old manifest or catalog digest is invalid');
  }
  if (!FLOOR.test(floor)) throw new Error('old migration floor is invalid');
  for (const key of [
    'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST',
    'BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST',
  ]) {
    if (!DIGEST.test(read(env, key))) throw new Error(`${key} is invalid`);
  }
  const catalogDirectory = read(env, 'BOOKING_MIGRATION_CATALOG_DIR');
  if (!isAbsolute(catalogDirectory)) {
    throw new Error('migration catalog path must be absolute');
  }
  return {
    env,
    releaseId,
    gitSha,
    manifestDigest,
    catalogDigest,
    floor,
    history: parseHistory(read(env, 'BOOKING_BASELINE_APPROVED_HISTORY_JSON')),
    schemaDiffReceiptDigest: read(
      env,
      'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST',
    ),
    backupReceiptDigest: read(env, 'BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST'),
    catalogDirectory,
  };
}

export function validateHistoricalPlan(
  catalog: MigrationCatalog,
  floor: string,
  expectedDigest: string,
  approved: Array<{ timestamp: string; name: string }>,
) {
  const prefix = migrationCatalogThrough(catalog, floor);
  if (prefix.catalogDigest !== expectedDigest) {
    throw new Error('old migration catalog digest mismatch');
  }
  const expected = prefix.entries.map((entry) => {
    const timestamp = entry.migration.slice(0, entry.migration.indexOf('-'));
    return { timestamp, name: entry.className };
  });
  if (JSON.stringify(expected) !== JSON.stringify(approved)) {
    throw new Error('approved historical migration ledger is not exact');
  }
  return expected;
}

export function validateSchemaDiffReceipt(
  value: unknown,
  guard: BaselineGuard,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('schema diff receipt is invalid');
  }
  const receipt = value as Record<string, unknown>;
  const expectedKeys = [
    'backendImage',
    'backendImageDigest',
    'backendImageId',
    'database',
    'databaseUser',
    'deploymentBinding',
    'environment',
    'gitSha',
    'legacyImageBinding',
    'legacyManifestDigestMode',
    'manifestDigest',
    'migrationCatalogDigest',
    'migrationFloor',
    'observedAt',
    'releaseId',
    'schema',
    'schemaDiff',
    'schemaLogDigest',
    'slot',
    'verification',
  ].sort();
  if (Object.keys(receipt).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error('schema diff receipt fields are invalid');
  }
  const diff = receipt.schemaDiff as Record<string, unknown> | undefined;
  const verification = receipt.verification as
    | Record<string, unknown>
    | undefined;
  const legacy = receipt.legacyImageBinding as
    | Record<string, unknown>
    | undefined;
  const deployment = receipt.deploymentBinding as
    | Record<string, unknown>
    | undefined;
  if (
    receipt.schema !== 'booking.schema-diff-receipt/v1' ||
    !deployment ||
    Object.keys(deployment).sort().join(',') !==
      'approvalId,currentManifestDigest,environment,fencingEpoch,generation,holderId,leaseId,operationId,phase,project,runtimeEnvDigest' ||
    deployment.environment !== 'preprod' ||
    deployment.project !== 'booking-preprod' ||
    deployment.phase !== 'STAGED' ||
    !Number.isInteger(deployment.generation) ||
    Number(deployment.generation) < 1 ||
    !Number.isInteger(deployment.fencingEpoch) ||
    Number(deployment.fencingEpoch) < 1 ||
    !DIGEST.test(String(deployment.currentManifestDigest || '')) ||
    !DIGEST.test(String(deployment.runtimeEnvDigest || '')) ||
    ['operationId', 'approvalId', 'leaseId', 'holderId'].some(
      (key) =>
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
          String(deployment[key] || ''),
        ),
    ) ||
    receipt.environment !== 'preproduction' ||
    receipt.database !== 'booking_preprod' ||
    receipt.databaseUser !== 'booking_preprod' ||
    receipt.releaseId !== guard.releaseId ||
    receipt.releaseId !== 'booking-20260908T202714Z-317be4dec675' ||
    receipt.gitSha !== guard.gitSha ||
    receipt.gitSha !== '317be4dec6752592eb7fdb7ff91b17820d00e652' ||
    receipt.slot !== 'green' ||
    receipt.manifestDigest !== guard.manifestDigest ||
    receipt.manifestDigest !==
      'sha256:0a597f6f3825f670d8a64dc6e19eec98b684e418994403257e0dd5502d983743' ||
    receipt.legacyManifestDigestMode !== 'raw-bytes' ||
    receipt.migrationCatalogDigest !== guard.catalogDigest ||
    receipt.migrationCatalogDigest !==
      'sha256:0e7a7e34490864497391ae86953920b2ea20926ae1aba79fcea151e7c2fbab24' ||
    receipt.migrationFloor !== guard.floor ||
    receipt.migrationFloor !==
      '1788720000000-HardenPaymentSettlementIdentity' ||
    receipt.backendImage !==
      'booking-preprod-backend:booking-20260908T202714Z-317be4dec675' ||
    receipt.backendImageDigest !==
      'sha256:a1bebe8670c2dc5524c9cd3b0d91a3274d85365a6b252c3cdd9907c6b48695ee' ||
    receipt.backendImageId !== receipt.backendImageDigest ||
    !DIGEST.test(String(receipt.schemaLogDigest || '')) ||
    !legacy ||
    Object.keys(legacy).sort().join(',') !==
      'currentGreenContainerId,currentGreenContainerImageBound,manifestRepository,ociLabelsAbsent,scope,uniqueTag' ||
    legacy.scope !== 'preproduction-old-green-only' ||
    legacy.manifestRepository !== 'local/booking-preprod-backend' ||
    legacy.uniqueTag !==
      'booking-preprod-backend:booking-20260908T202714Z-317be4dec675' ||
    legacy.ociLabelsAbsent !== true ||
    !/^[0-9a-f]{12,64}$/.test(String(legacy.currentGreenContainerId || '')) ||
    legacy.currentGreenContainerImageBound !== true ||
    !diff ||
    Object.keys(diff).sort().join(',') !== 'downCount,upCount' ||
    diff.upCount !== 0 ||
    diff.downCount !== 0 ||
    !verification ||
    Object.keys(verification).sort().join(',') !==
      'containerImageBound,exactReadback,imageBound' ||
    verification.imageBound !== true ||
    verification.containerImageBound !== true ||
    verification.exactReadback !== true ||
    typeof receipt.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  ) {
    throw new Error('schema diff receipt binding is invalid');
  }
  const age = Date.now() - Date.parse(receipt.observedAt);
  if (age < 0 || age > 60 * 60 * 1000) {
    throw new Error('schema diff receipt is stale or future-dated');
  }
}

async function assertLedgerAbsent(queryRunner: QueryRunner) {
  const rows = (await queryRunner.query(
    "SELECT to_regclass('public.migrations') AS relation",
  )) as Array<{ relation: string | null }>;
  if (rows[0]?.relation !== null)
    throw new Error('migration ledger already exists');
}

export async function applyBaselineLedger(
  dataSource: DataSource,
  history: Array<{ timestamp: string; name: string }>,
) {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction('SERIALIZABLE');
  try {
    await queryRunner.query(
      "SELECT pg_advisory_xact_lock(hashtext('booking-preprod:migration-baseline'))",
    );
    await assertLedgerAbsent(queryRunner);
    await queryRunner.query(
      'CREATE TABLE "migrations" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_migrations_id" PRIMARY KEY ("id"))',
    );
    for (const entry of history) {
      await queryRunner.query(
        'INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)',
        [entry.timestamp, entry.name],
      );
    }
    const inside = (await queryRunner.query(
      'SELECT "timestamp"::text AS "timestamp", "name" FROM "migrations" ORDER BY "timestamp" ASC, "id" ASC',
    )) as Array<{ timestamp: string; name: string }>;
    if (JSON.stringify(inside) !== JSON.stringify(history)) {
      throw new Error('migration baseline transaction readback mismatch');
    }
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
  const readback = await dataSource.query(
    'SELECT "timestamp"::text AS "timestamp", "name" FROM "migrations" ORDER BY "timestamp" ASC, "id" ASC',
  );
  if (JSON.stringify(readback) !== JSON.stringify(history)) {
    throw new Error('migration baseline committed readback mismatch');
  }
  return readback;
}

export async function verifyBaselineLedgerReadback(
  dataSource: DataSource,
  history: Array<{ timestamp: string; name: string }>,
) {
  const readback = await dataSource.query(
    'SELECT "timestamp"::text AS "timestamp", "name" FROM "migrations" ORDER BY "timestamp" ASC, "id" ASC',
  );
  if (JSON.stringify(readback) !== JSON.stringify(history)) {
    throw new Error('migration baseline ledger readback is not exact');
  }
  return readback;
}

export async function baselinePreprodMigrationLedger(
  input: EnvMap = process.env,
  action: 'apply' | 'verify' = 'apply',
) {
  const guard = validateBaselineEnvironment(input);
  const catalog = inspectMigrationCatalog(guard.catalogDirectory);
  const history = validateHistoricalPlan(
    catalog,
    guard.floor,
    guard.catalogDigest,
    guard.history,
  );
  let backupDigest: string | undefined;
  if (action === 'apply') {
    const schemaDiff = readReceipt(
      read(guard.env, 'BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_FILE'),
      guard.schemaDiffReceiptDigest,
      'schema diff',
    );
    validateSchemaDiffReceipt(schemaDiff, guard);
    const backup = readReceipt(
      read(guard.env, 'BOOKING_BASELINE_BACKUP_RECEIPT_FILE'),
      guard.backupReceiptDigest,
      'backup',
    );
    const backupReceipt = validateBackupReceipt(backup, {
      environment: 'preproduction',
      database: 'booking_preprod',
      releaseId: guard.releaseId,
      gitSha: guard.gitSha,
      manifestDigest: guard.manifestDigest,
      migrationCatalogDigest: guard.catalogDigest,
      manifestDigestMode: 'raw-bytes',
    });
    const backupAge = Date.now() - Date.parse(backupReceipt.verifiedAt);
    if (backupAge < 0 || backupAge > 60 * 60 * 1000) {
      throw new Error('backup receipt is stale or future-dated');
    }
    backupDigest = backupReceipt.backupDigest;
  }
  for (const [key, value] of Object.entries(guard.env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
  const { default: dataSource } = await import('../../data-source');
  await dataSource.initialize();
  try {
    const readback =
      action === 'apply'
        ? await applyBaselineLedger(dataSource, history)
        : await verifyBaselineLedgerReadback(dataSource, history);
    const receipt = {
      schema:
        action === 'apply'
          ? 'booking.migration-baseline-receipt/v1'
          : 'booking.migration-baseline-readback/v1',
      environment: 'preproduction',
      database: 'booking_preprod',
      releaseId: guard.releaseId,
      gitSha: guard.gitSha,
      manifestDigest: guard.manifestDigest,
      migrationCatalogDigest: guard.catalogDigest,
      migrationFloor: guard.floor,
      historyCount: readback.length,
      historyDigest: sha256(Buffer.from(JSON.stringify(readback))),
      schemaDiffReceiptDigest: guard.schemaDiffReceiptDigest,
      backupReceiptDigest: guard.backupReceiptDigest,
      ...(backupDigest ? { backupDigest } : {}),
      verification:
        action === 'apply'
          ? { atomic: true, exactReadback: true }
          : { exactReadback: true },
      completedAt: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  const actionArgument = process.argv.slice(2);
  const action =
    actionArgument.length === 1 && actionArgument[0] === '--action=verify'
      ? 'verify'
      : actionArgument.length === 0 ||
          (actionArgument.length === 1 &&
            actionArgument[0] === '--action=apply')
        ? 'apply'
        : null;
  if (!action) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: 'BOOKING_BASELINE_ACTION_INVALID' })}\n`,
    );
    process.exitCode = 1;
  } else
    void baselinePreprodMigrationLedger(process.env, action).catch(() => {
      process.stderr.write(
        `${JSON.stringify({ ok: false, code: 'BOOKING_BASELINE_LEDGER_FAILED' })}\n`,
      );
      process.exitCode = 1;
    });
}
