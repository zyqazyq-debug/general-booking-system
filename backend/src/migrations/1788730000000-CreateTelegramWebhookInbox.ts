import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTelegramWebhookInbox1788730000000 implements MigrationInterface {
  name = 'CreateTelegramWebhookInbox1788730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "telegram_webhook_updates" (
        "update_id" bigint PRIMARY KEY,
        "status" varchar(16) NOT NULL,
        "claim_token" varchar(36) NOT NULL,
        "lease_expires_at" timestamptz NOT NULL,
        "processed_at" timestamptz NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_telegram_webhook_updates_status"
          CHECK ("status" IN ('processing', 'processed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_telegram_webhook_updates_processing_lease" ON "telegram_webhook_updates" ("status", "lease_expires_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE "telegram_webhook_operations" (
        "idempotency_key" varchar(200) PRIMARY KEY,
        "update_id" bigint NOT NULL,
        "operation" varchar(80) NOT NULL,
        "resource_hash" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "result_payload" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_telegram_webhook_operations_status"
          CHECK ("status" IN ('started', 'completed', 'failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_telegram_webhook_operations_update" ON "telegram_webhook_operations" ("update_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "telegram_binding_tickets" (
        "token_hash" varchar(64) PRIMARY KEY,
        "kind" varchar(16) NOT NULL,
        "user_id" uuid NULL,
        "status" varchar(16) NOT NULL,
        "result_payload" text NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_telegram_binding_tickets_kind"
          CHECK ("kind" IN ('login', 'binding')),
        CONSTRAINT "CHK_telegram_binding_tickets_status"
          CHECK ("status" IN ('pending', 'success', 'expired'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_binding_tickets"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "telegram_webhook_operations"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_telegram_webhook_updates_processing_lease"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_webhook_updates"`);
  }
}
