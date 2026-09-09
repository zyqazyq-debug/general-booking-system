import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectMigrationCatalog,
  validateBackupReceipt,
  validateMigrationEnvironment,
  verifyMigrationPlan,
  verifyCompletedMigrationLedger,
} from './run-migrations';

const digest = `sha256:${'a'.repeat(64)}`;
const deploymentBinding = {
  environment: 'preprod',
  project: 'booking-preprod',
  operationId: 'op-1',
  approvalId: 'approval-1',
  generation: 3,
  fencingEpoch: 1,
  leaseId: 'lease-1',
  holderId: 'owner-1',
  currentManifestDigest: digest,
};
const valid = () => ({
  BOOKING_SCHEMA_MIGRATE: 'true',
  BOOKING_MIGRATION_ENVIRONMENT: 'preproduction',
  BOOKING_MIGRATION_EXPECTED_DATABASE: 'booking_preprod',
  BOOKING_MIGRATION_APPROVED_PENDING_JSON: '[]',
  BOOKING_MIGRATION_CATALOG_DIGEST: digest,
  BOOKING_MIGRATION_EXPECTED_FLOOR: '1788740000000-AddSafe',
  BOOKING_MIGRATION_CATALOG_DIR: 'C:\\app\\migration-source',
  BOOKING_MIGRATION_BACKUP_RECEIPT_FILE: 'C:\\evidence\\backup.json',
  BOOKING_MIGRATION_BACKUP_RECEIPT_DIGEST: digest,
  BOOKING_RELEASE_ID: 'booking-20260909T010203Z-abcdef123456',
  BOOKING_GIT_SHA: 'a'.repeat(40),
  BOOKING_MANIFEST_DIGEST: digest,
  NODE_ENV: 'preproduction',
  USE_POSTGRES: 'true',
  TYPEORM_SYNCHRONIZE: 'false',
  POSTGRES_HOST: 'postgres',
  POSTGRES_USER: 'booking_preprod',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_DB: 'booking_preprod',
});

describe('migration runtime guard', () => {
  it('accepts only an explicitly bound release, catalog, backup and target', () => {
    expect(validateMigrationEnvironment(valid())).toMatchObject({
      database: 'booking_preprod',
      environment: 'preproduction',
      approvedPending: [],
    });
  });

  it('rejects target, environment and plan acknowledgement mismatches', () => {
    expect(() =>
      validateMigrationEnvironment({
        ...valid(),
        BOOKING_MIGRATION_EXPECTED_DATABASE: 'booking_prod',
      }),
    ).toThrow('database acknowledgement mismatch');
    expect(() =>
      validateMigrationEnvironment({
        ...valid(),
        BOOKING_MIGRATION_ENVIRONMENT: 'production',
      }),
    ).toThrow('environment acknowledgement mismatch');
    expect(() =>
      validateMigrationEnvironment({
        ...valid(),
        BOOKING_MIGRATION_APPROVED_PENDING_JSON: '["A","A"]',
      }),
    ).toThrow('allowlist is invalid');
  });

  it('rejects an unarmed or synchronizing runtime', () => {
    expect(() =>
      validateMigrationEnvironment({ ...valid(), BOOKING_SCHEMA_MIGRATE: '' }),
    ).toThrow('BOOKING_SCHEMA_MIGRATE=true');
    expect(() =>
      validateMigrationEnvironment({ ...valid(), TYPEORM_SYNCHRONIZE: 'true' }),
    ).toThrow('must remain false');
  });

  it('binds the backup receipt to the exact release, database and catalog', () => {
    const expected = {
      environment: 'preproduction' as const,
      database: 'booking_preprod',
      releaseId: 'booking-20260909T010203Z-abcdef123456',
      gitSha: 'a'.repeat(40),
      manifestDigest: digest,
      migrationCatalogDigest: digest,
      manifestDigestMode: 'canonical-json' as const,
    };
    const receipt = {
      schema: 'booking.database-backup-receipt/v1',
      ...expected,
      databaseUser: 'booking_preprod',
      deploymentBinding,
      backupDigest: digest,
      verifiedAt: '2026-09-09T01:00:00.000Z',
      verification: { pgRestoreList: true },
    };
    expect(validateBackupReceipt(receipt, expected)).toEqual(receipt);
    expect(() =>
      validateBackupReceipt({ ...receipt, database: 'booking_prod' }, expected),
    ).toThrow('binding is invalid');
    expect(() =>
      validateBackupReceipt(
        {
          ...receipt,
          deploymentBinding: { ...deploymentBinding, generation: 0 },
        },
        expected,
      ),
    ).toThrow('binding is invalid');
  });

  it('rejects unknown, unapproved and destructive pending migrations', () => {
    const catalog = {
      expandFloor: '1788740000000-AddSafe',
      catalogDigest: digest,
      entries: [
        {
          migration: '1788700000000-OldDestructive',
          className: 'OldDestructive1788700000000',
          digest,
          destructive: true,
        },
        {
          migration: '1788740000000-AddSafe',
          className: 'AddSafe1788740000000',
          digest,
          destructive: false,
        },
      ],
    };
    expect(() =>
      verifyMigrationPlan(catalog, ['Unknown1770000000000'], []),
    ).toThrow('unknown migrations');
    expect(() =>
      verifyMigrationPlan(catalog, ['OldDestructive1788700000000'], []),
    ).toThrow('approved exact allowlist');
    expect(() =>
      verifyMigrationPlan(
        catalog,
        [],
        ['OldDestructive1788700000000', 'AddSafe1788740000000'],
      ),
    ).toThrow('destructive pending');
    expect(
      verifyMigrationPlan(
        catalog,
        ['OldDestructive1788700000000'],
        ['AddSafe1788740000000'],
      ),
    ).toEqual(['AddSafe1788740000000']);
    expect(
      verifyMigrationPlan(
        catalog,
        ['OldDestructive1788700000000', 'AddSafe1788740000000'],
        ['AddSafe1788740000000'],
      ),
    ).toEqual([]);
    expect(
      verifyMigrationPlan(
        catalog,
        ['OldDestructive1788700000000', 'AddSafe1788740000000'],
        [],
      ),
    ).toEqual([]);
    expect(() =>
      verifyMigrationPlan(
        catalog,
        ['OldDestructive1788700000000', 'AddSafe1788740000000'],
        ['OldDestructive1788700000000'],
      ),
    ).toThrow('approved exact allowlist');
    expect(() =>
      verifyMigrationPlan(
        catalog,
        ['AddSafe1788740000000'],
        ['OldDestructive1788700000000'],
      ),
    ).toThrow('not a catalog prefix');
  });

  it('computes the manifest-compatible source catalog and class safety', () => {
    const directory = mkdtempSync(join(tmpdir(), 'booking-catalog-'));
    try {
      writeFileSync(
        join(directory, '1788730000000-AddSafe.ts'),
        'export class AddSafe1788730000000 { public async up(queryRunner: any) { await queryRunner.query(`CREATE TABLE safe (id bigint)`); } }',
      );
      writeFileSync(
        join(directory, '1788740000000-DropOld.ts'),
        'export class DropOld1788740000000 { public async up(queryRunner: any) { await queryRunner.query(`DROP TABLE old`); } }',
      );
      const catalog = inspectMigrationCatalog(directory);
      expect(catalog.expandFloor).toBe('1788740000000-DropOld');
      expect(catalog.catalogDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(catalog.entries.map((entry) => entry.destructive)).toEqual([
        false,
        true,
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts only a complete exact migration ledger for independent readback', () => {
    const catalog = {
      expandFloor: '1788740000000-AddSafe',
      catalogDigest: digest,
      entries: [
        {
          migration: '1788730000000-First',
          className: 'First1788730000000',
          digest,
          destructive: false,
        },
        {
          migration: '1788740000000-AddSafe',
          className: 'AddSafe1788740000000',
          digest,
          destructive: false,
        },
      ],
    };
    expect(
      verifyCompletedMigrationLedger(catalog, [
        'First1788730000000',
        'AddSafe1788740000000',
      ]),
    ).toMatchObject({
      migrationCount: 2,
      ledgerHead: 'AddSafe1788740000000',
    });
    expect(() =>
      verifyCompletedMigrationLedger(catalog, ['First1788730000000']),
    ).toThrow('does not exactly match catalog');
    expect(() =>
      verifyCompletedMigrationLedger(catalog, [
        'AddSafe1788740000000',
        'First1788730000000',
      ]),
    ).toThrow('does not exactly match catalog');
  });
});
