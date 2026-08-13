import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixDatetimeColumnsForPostgres1774200000001 implements MigrationInterface {
  name = 'FixDatetimeColumnsForPostgres1774200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE "collection_quota_subscriptions" ALTER COLUMN "cycle_start" TYPE timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_subscriptions" ALTER COLUMN "cycle_end" TYPE timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_subscriptions" ALTER COLUMN "next_billing_at" TYPE timestamp`,
    );

    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ALTER COLUMN "period_start" TYPE timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ALTER COLUMN "period_end" TYPE timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ALTER COLUMN "paid_at" TYPE timestamp`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await Promise.resolve();
    void queryRunner;
  }
}
