import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDataIntegrityAndOrderIndexes1773571800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_share_links_creator'
        ) THEN
          ALTER TABLE "share_links"
          ADD CONSTRAINT "fk_share_links_creator"
          FOREIGN KEY ("creator_id")
          REFERENCES "user"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_collection_quota_subscriptions_user'
        ) THEN
          ALTER TABLE "collection_quota_subscriptions"
          ADD CONSTRAINT "fk_collection_quota_subscriptions_user"
          FOREIGN KEY ("user_id")
          REFERENCES "user"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_collection_quota_bills_user'
        ) THEN
          ALTER TABLE "collection_quota_bills"
          ADD CONSTRAINT "fk_collection_quota_bills_user"
          FOREIGN KEY ("user_id")
          REFERENCES "user"("id")
          ON DELETE RESTRICT
          ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_owner_created_at"
      ON "orders" ("owner_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_owner_start_time"
      ON "orders" ("owner_id", "start_time")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_orders_owner_start_time"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_orders_owner_created_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "collection_quota_bills"
      DROP CONSTRAINT IF EXISTS "fk_collection_quota_bills_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "collection_quota_subscriptions"
      DROP CONSTRAINT IF EXISTS "fk_collection_quota_subscriptions_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "share_links"
      DROP CONSTRAINT IF EXISTS "fk_share_links_creator"
    `);
  }
}
