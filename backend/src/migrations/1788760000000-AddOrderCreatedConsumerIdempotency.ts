import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderCreatedConsumerIdempotency1788760000000 implements MigrationInterface {
  name = 'AddOrderCreatedConsumerIdempotency1788760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_order_event_consumptions" (
        "event_id" uuid NOT NULL,
        "processed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_order_event_consumptions" PRIMARY KEY ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_notification_deliveries" (
        "id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "recipient_id" varchar(128) NOT NULL,
        "status" varchar(16) NOT NULL,
        "claim_token" varchar(36) NULL,
        "lease_expires_at" timestamptz NULL,
        "sent_at" timestamptz NULL,
        "provider_message_id" varchar(64) NULL,
        "last_error_type" varchar(128) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_order_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "uq_order_notification_event_recipient"
          UNIQUE ("event_id", "recipient_id"),
        CONSTRAINT "chk_order_notification_delivery_status"
          CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
        CONSTRAINT "chk_order_notification_delivery_receipt"
          CHECK (
            ("status" = 'sent' AND "provider_message_id" IS NOT NULL)
            OR ("status" <> 'sent' AND "provider_message_id" IS NULL)
          )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_order_notification_status_lease" ON "order_notification_deliveries" ("status", "lease_expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(
      `DROP TABLE IF EXISTS "order_notification_deliveries"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agency_order_event_consumptions"`,
    );
  }
}
