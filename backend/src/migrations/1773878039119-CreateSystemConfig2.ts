import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSystemConfig21773878039119 implements MigrationInterface {
  name = 'CreateSystemConfig21773878039119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_699439b0ec83fe4646d252cc1b"`,
    );
    await queryRunner.query(
      `CREATE TABLE "system_configs" ("key" character varying NOT NULL, "value" text NOT NULL, "description" character varying, "type" character varying NOT NULL DEFAULT 'string', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5aff9a6d272a5cedf54d7aaf617" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_0a4206ce70c19a82d7c91d57ec8"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "douyin_openid"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_40a99a6ea100782bdf31fb1ffe8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "xiaohongshu_openid"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "gender"`);
    await queryRunner.query(`DROP TYPE "public"."user_gender_enum"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "edu_background"`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN "bio"`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN "subjects"`);
    await queryRunner.query(
      `ALTER TABLE "services" DROP COLUMN "grade_levels"`,
    );
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN "tags"`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN "images"`);
    await queryRunner.query(
      `ALTER TABLE "services" DROP COLUMN "teaching_mode"`,
    );
    await queryRunner.query(`DROP TYPE "public"."services_teaching_mode_enum"`);
    await queryRunner.query(
      `ALTER TABLE "services" DROP COLUMN "service_mode"`,
    );
    await queryRunner.query(`DROP TYPE "public"."services_service_mode_enum"`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN "region_code"`);
    await queryRunner.query(
      `ALTER TABLE "services" DROP COLUMN "address_detail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "services" DROP COLUMN "search_vector"`,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" DROP COLUMN "period_end"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_quota_bills" DROP COLUMN "period_start"`,
    );
    await queryRunner.query(`ALTER TABLE "referral_logs" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."referral_logs_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "services" ADD "search_vector" tsvector`,
    );
    await queryRunner.query(`ALTER TABLE "services" ADD "address_detail" text`);
    await queryRunner.query(
      `ALTER TABLE "services" ADD "region_code" character varying(6)`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."services_service_mode_enum" AS ENUM('ONLINE', 'OFFLINE_STUDENT_HOME', 'OFFLINE_TUTOR_HOME')`,
    );
    await queryRunner.query(
      `ALTER TABLE "services" ADD "service_mode" "public"."services_service_mode_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."services_teaching_mode_enum" AS ENUM('ONLINE', 'OFFLINE', 'HYBRID')`,
    );
    await queryRunner.query(
      `ALTER TABLE "services" ADD "teaching_mode" "public"."services_teaching_mode_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "services" ADD "images" jsonb`);
    await queryRunner.query(`ALTER TABLE "services" ADD "tags" jsonb`);
    await queryRunner.query(`ALTER TABLE "services" ADD "grade_levels" jsonb`);
    await queryRunner.query(`ALTER TABLE "services" ADD "subjects" jsonb`);
    await queryRunner.query(`ALTER TABLE "services" ADD "bio" text`);
    await queryRunner.query(`ALTER TABLE "user" ADD "edu_background" jsonb`);
    await queryRunner.query(
      `CREATE TYPE "public"."user_gender_enum" AS ENUM('MALE', 'FEMALE', 'UNKNOWN')`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "gender" "public"."user_gender_enum" NOT NULL DEFAULT 'UNKNOWN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "xiaohongshu_openid" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_40a99a6ea100782bdf31fb1ffe8" UNIQUE ("xiaohongshu_openid")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "douyin_openid" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_0a4206ce70c19a82d7c91d57ec8" UNIQUE ("douyin_openid")`,
    );
    await queryRunner.query(`DROP TABLE "system_configs"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_699439b0ec83fe4646d252cc1b" ON "services" ("search_vector") `,
    );
  }
}
