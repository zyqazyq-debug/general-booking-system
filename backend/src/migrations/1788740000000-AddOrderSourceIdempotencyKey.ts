import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderSourceIdempotencyKey1788740000000 implements MigrationInterface {
  name = 'AddOrderSourceIdempotencyKey1788740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;

    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_idempotency_key" varchar(191) NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_source_idempotency_key" ON "orders" ("source_idempotency_key") WHERE "source_idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;

    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_orders_source_idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "source_idempotency_key"`,
    );
  }
}
