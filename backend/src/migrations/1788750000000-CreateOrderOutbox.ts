import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderOutbox1788750000000 implements MigrationInterface {
  name = 'CreateOrderOutbox1788750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_outbox_events" (
        "id" uuid PRIMARY KEY,
        "aggregate_id" uuid NOT NULL,
        "event_type" varchar(64) NOT NULL,
        "idempotency_key" varchar(191) NOT NULL,
        "payload" text NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "claim_token" varchar(36) NULL,
        "lease_expires_at" timestamptz NULL,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz NULL,
        "last_error" varchar(1000) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_order_outbox_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "chk_order_outbox_status"
          CHECK ("status" IN ('pending', 'processing', 'processed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_order_outbox_dispatch" ON "order_outbox_events" ("status", "available_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_order_outbox_processing_lease" ON "order_outbox_events" ("status", "lease_expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_order_outbox_aggregate" ON "order_outbox_events" ("aggregate_id", "event_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`DROP TABLE IF EXISTS "order_outbox_events"`);
  }
}
