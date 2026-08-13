import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommissionRecordIndexes1773895200000 implements MigrationInterface {
  name = 'AddCommissionRecordIndexes1773895200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commissions_order_agent"
      ON "commission_records" ("order_id", "agent_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commissions_order_level"
      ON "commission_records" ("order_id", "level")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_commissions_order_level"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_commissions_order_agent"`,
    );
  }
}
