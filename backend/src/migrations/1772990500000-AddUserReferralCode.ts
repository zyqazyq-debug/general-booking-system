import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserReferralCode1772990500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "user"
            ADD COLUMN IF NOT EXISTS "referral_code" character varying(6)
        `);

    await queryRunner.query(`
            WITH numbered AS (
                SELECT id, UPPER(LPAD(TO_HEX(ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)), 6, '0')) AS code
                FROM "user"
            )
            UPDATE "user" u
            SET "referral_code" = numbered.code
            FROM numbered
            WHERE u.id = numbered.id
              AND u."referral_code" IS NULL
        `);

    await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_referral_code"
            ON "user" ("referral_code")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_user_referral_code"
        `);
    await queryRunner.query(`
            ALTER TABLE "user"
            DROP COLUMN IF EXISTS "referral_code"
        `);
  }
}
