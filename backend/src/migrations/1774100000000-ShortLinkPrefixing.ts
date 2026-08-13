import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShortLinkPrefixing1774100000000 implements MigrationInterface {
  name = 'ShortLinkPrefixing1774100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "referral_code" TYPE character varying(7)
    `);

    await queryRunner.query(`
      UPDATE "user"
      SET "referral_code" = 'R' || "referral_code"
      WHERE "referral_code" IS NOT NULL
        AND LENGTH("referral_code") = 6
    `);

    await queryRunner.query(`
      UPDATE "agency_nodes"
      SET "share_slug" = 's' || "share_slug"
      WHERE "share_slug" IS NOT NULL
        AND "share_slug" NOT LIKE 's%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      UPDATE "agency_nodes"
      SET "share_slug" = SUBSTRING("share_slug" FROM 2)
      WHERE "share_slug" ~ '^s[0-9a-f]{8}$'
    `);

    await queryRunner.query(`
      UPDATE "user"
      SET "referral_code" = SUBSTRING("referral_code" FROM 2)
      WHERE "referral_code" ~ '^R[2-9A-Z]{6}$'
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "referral_code" TYPE character varying(6)
    `);
  }
}
