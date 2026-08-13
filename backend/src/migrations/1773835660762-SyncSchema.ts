import { MigrationInterface, QueryRunner } from 'typeorm';

export class SyncSchema1773835660762 implements MigrationInterface {
  name = 'SyncSchema1773835660762';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "share_links" DROP CONSTRAINT "fk_share_links_creator"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agency_nodes" DROP CONSTRAINT "fk_agency_nodes_parent_node_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_subscriptions" DROP CONSTRAINT "fk_collection_quota_subscriptions_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" DROP CONSTRAINT "fk_collection_quota_bills_user"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_user_referral_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_user_no"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "user_no"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "username_changed_at"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_logs_status_enum" AS ENUM('PENDING', 'COMPLETED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_logs" ADD "status" "public"."referral_logs_status_enum" NOT NULL DEFAULT 'PENDING'`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ADD "period_start" TIMESTAMP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ADD "period_end" TIMESTAMP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agency_nodes" ADD CONSTRAINT "FK_508922913c51da9ee7968f120fe" FOREIGN KEY ("parent_node_id") REFERENCES "agency_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agency_nodes" DROP CONSTRAINT "FK_508922913c51da9ee7968f120fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" DROP COLUMN "period_end"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" DROP COLUMN "period_start"`,
    );
    await queryRunner.query(`ALTER TABLE "referral_logs" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."referral_logs_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD "username_changed_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "user_no" character varying(10) NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "refresh_tokens" text`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_user_no" ON "user" ("user_no") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_referral_code" ON "user" ("referral_code") `,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" ADD CONSTRAINT "fk_collection_quota_bills_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_subscriptions" ADD CONSTRAINT "fk_collection_quota_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agency_nodes" ADD CONSTRAINT "fk_agency_nodes_parent_node_id" FOREIGN KEY ("parent_node_id") REFERENCES "agency_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "share_links" ADD CONSTRAINT "fk_share_links_creator" FOREIGN KEY ("creator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
