import {
  applyBaselineLedger,
  validateBaselineEnvironment,
  validateHistoricalPlan,
  validateSchemaDiffReceipt,
  verifyBaselineLedgerReadback,
} from './baseline-preprod-migration-ledger';
import {
  migrationCatalogThrough,
  verifyPendingMigrationShapes,
} from './run-migrations';

const digest = `sha256:${'a'.repeat(64)}`;
const history = [
  { timestamp: '1788700000000', name: 'HardenAuth1788700000000' },
  { timestamp: '1788720000000', name: 'HardenPayment1788720000000' },
];
const env = () => ({
  BOOKING_SCHEMA_BASELINE: 'true',
  NODE_ENV: 'preproduction',
  POSTGRES_HOST: 'postgres',
  POSTGRES_DB: 'booking_preprod',
  POSTGRES_USER: 'booking_preprod',
  POSTGRES_PASSWORD: 'fixture',
  BOOKING_BASELINE_EXPECTED_DATABASE: 'booking_preprod',
  BOOKING_BASELINE_OLD_RELEASE_ID: 'booking-20260908T202714Z-317be4dec675',
  BOOKING_BASELINE_OLD_GIT_SHA: '3'.repeat(40),
  BOOKING_BASELINE_OLD_MANIFEST_DIGEST: digest,
  BOOKING_BASELINE_OLD_CATALOG_DIGEST: digest,
  BOOKING_BASELINE_OLD_FLOOR: '1788720000000-HardenPayment',
  BOOKING_BASELINE_APPROVED_HISTORY_JSON: JSON.stringify(history),
  BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_FILE: 'C:\\evidence\\diff.json',
  BOOKING_BASELINE_SCHEMA_DIFF_RECEIPT_DIGEST: digest,
  BOOKING_BASELINE_BACKUP_RECEIPT_FILE: 'C:\\evidence\\backup.json',
  BOOKING_BASELINE_BACKUP_RECEIPT_DIGEST: digest,
  BOOKING_MIGRATION_CATALOG_DIR: 'C:\\app\\migration-source',
});

describe('preproduction migration ledger baseline', () => {
  it('accepts only the fixed raw-byte legacy image/schema-diff binding', () => {
    const guard = {
      releaseId: 'booking-20260908T202714Z-317be4dec675',
      gitSha: '317be4dec6752592eb7fdb7ff91b17820d00e652',
      manifestDigest:
        'sha256:0a597f6f3825f670d8a64dc6e19eec98b684e418994403257e0dd5502d983743',
      catalogDigest:
        'sha256:0e7a7e34490864497391ae86953920b2ea20926ae1aba79fcea151e7c2fbab24',
      floor: '1788720000000-HardenPaymentSettlementIdentity',
    } as any;
    const receipt = {
      schema: 'booking.schema-diff-receipt/v1',
      environment: 'preproduction',
      database: 'booking_preprod',
      databaseUser: 'booking_preprod',
      releaseId: guard.releaseId,
      gitSha: guard.gitSha,
      slot: 'green',
      manifestDigest: guard.manifestDigest,
      legacyManifestDigestMode: 'raw-bytes',
      migrationCatalogDigest: guard.catalogDigest,
      migrationFloor: guard.floor,
      backendImage:
        'booking-preprod-backend:booking-20260908T202714Z-317be4dec675',
      backendImageDigest:
        'sha256:a1bebe8670c2dc5524c9cd3b0d91a3274d85365a6b252c3cdd9907c6b48695ee',
      backendImageId:
        'sha256:a1bebe8670c2dc5524c9cd3b0d91a3274d85365a6b252c3cdd9907c6b48695ee',
      legacyImageBinding: {
        scope: 'preproduction-old-green-only',
        manifestRepository: 'local/booking-preprod-backend',
        uniqueTag:
          'booking-preprod-backend:booking-20260908T202714Z-317be4dec675',
        ociLabelsAbsent: true,
        currentGreenContainerId: 'a'.repeat(64),
        currentGreenContainerImageBound: true,
      },
      schemaLogDigest: digest,
      schemaDiff: { upCount: 0, downCount: 0 },
      observedAt: new Date().toISOString(),
      verification: {
        imageBound: true,
        containerImageBound: true,
        exactReadback: true,
      },
    };
    expect(() => validateSchemaDiffReceipt(receipt, guard)).not.toThrow();
    expect(() =>
      validateSchemaDiffReceipt(
        { ...receipt, legacyManifestDigestMode: 'canonical-json' },
        guard,
      ),
    ).toThrow('binding is invalid');
  });

  it('rejects production and requires exact isolated target evidence', () => {
    expect(validateBaselineEnvironment(env())).toMatchObject({
      floor: '1788720000000-HardenPayment',
      history,
    });
    expect(() =>
      validateBaselineEnvironment({ ...env(), NODE_ENV: 'production' }),
    ).toThrow('restricted to preproduction');
    expect(() =>
      validateBaselineEnvironment({ ...env(), POSTGRES_DB: 'booking_prod' }),
    ).toThrow('isolated preproduction database');
  });

  it('binds exact names and timestamp prefixes to the old catalog prefix', () => {
    const catalog = {
      expandFloor: '1788730000000-New',
      catalogDigest: 'unused',
      entries: [
        {
          migration: '1788700000000-HardenAuth',
          className: 'HardenAuth1788700000000',
          digest: `sha256:${'1'.repeat(64)}`,
          destructive: true,
        },
        {
          migration: '1788720000000-HardenPayment',
          className: 'HardenPayment1788720000000',
          digest: `sha256:${'2'.repeat(64)}`,
          destructive: false,
        },
        {
          migration: '1788730000000-New',
          className: 'New1788730000000',
          digest: `sha256:${'3'.repeat(64)}`,
          destructive: false,
        },
      ],
    };
    const exactDigest = migrationCatalogThrough(
      catalog,
      '1788720000000-HardenPayment',
    ).catalogDigest;
    const prefix = validateHistoricalPlan(
      catalog,
      '1788720000000-HardenPayment',
      exactDigest,
      history,
    );
    expect(prefix).toEqual(history);
  });

  it('atomically creates an absent ledger and verifies exact committed readback', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ relation: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce(history);
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query,
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      createQueryRunner: () => queryRunner,
      query: jest.fn().mockResolvedValue(history),
    };
    await expect(
      applyBaselineLedger(dataSource as any, history),
    ).resolves.toEqual(history);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('refuses an existing ledger before CREATE or INSERT', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ relation: 'migrations' }]),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    await expect(
      applyBaselineLedger(
        { createQueryRunner: () => queryRunner } as any,
        history,
      ),
    ).rejects.toThrow('already exists');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('independently rejects a missing, reordered or foreign baseline ledger', async () => {
    await expect(
      verifyBaselineLedgerReadback(
        { query: jest.fn().mockResolvedValue(history) } as any,
        history,
      ),
    ).resolves.toEqual(history);
    await expect(
      verifyBaselineLedgerReadback(
        { query: jest.fn().mockResolvedValue([...history].reverse()) } as any,
        history,
      ),
    ).rejects.toThrow('readback is not exact');
  });
});

describe('pending migration shape preflight', () => {
  it('allows a pristine target and rejects an existing touched object', async () => {
    const pristine = {
      query: jest.fn().mockResolvedValue([{ exists: false }]),
    };
    await expect(
      verifyPendingMigrationShapes(pristine as any, [
        'CreateTelegramWebhookInbox1788730000000',
        'AddOrderSourceIdempotencyKey1788740000000',
        'CreateOrderOutbox1788750000000',
        'AddOrderCreatedConsumerIdempotency1788760000000',
      ]),
    ).resolves.toBeUndefined();
    const probedSql = pristine.query.mock.calls
      .map(([sql]) => String(sql))
      .join('\n');
    expect(probedSql).toContain('to_regclass');
    expect(probedSql).toContain('information_schema.columns');
    expect(probedSql).toContain('pg_indexes');
    expect(probedSql).toContain('pg_constraint');

    const drifted = { query: jest.fn().mockResolvedValue([{ exists: true }]) };
    await expect(
      verifyPendingMigrationShapes(drifted as any, [
        'CreateOrderOutbox1788750000000',
      ]),
    ).rejects.toThrow('target shape is not pristine');
  });

  it('rejects a pending migration without an explicit shape contract', async () => {
    await expect(
      verifyPendingMigrationShapes({ query: jest.fn() } as any, [
        'FutureMigration9999999999999',
      ]),
    ).rejects.toThrow('no approved shape preflight');
  });
});
