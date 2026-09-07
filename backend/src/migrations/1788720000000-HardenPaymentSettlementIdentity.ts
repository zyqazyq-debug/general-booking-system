import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPaymentSettlementIdentity1788720000000 implements MigrationInterface {
  name = 'HardenPaymentSettlementIdentity1788720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "payment_event_id" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_transactions_payment_event_id" ON "payment_transactions" ("payment_event_id") WHERE "payment_event_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_transactions_trade_no" ON "payment_transactions" ("trade_no") WHERE "trade_no" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_payment_transactions_trade_no"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_payment_transactions_payment_event_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "payment_event_id"`,
    );
  }
}
