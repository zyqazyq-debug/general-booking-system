import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupDirtyShareLinksCreatorId1773573800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      UPDATE "share_links" s
      SET "status" = 'CANCELLED'
      WHERE s."creator_id" IS NULL
        AND s."status" = 'ACTIVE'
        AND s."target_type" = 'SINGLE'
        AND (
          s."target_id" !~ '^[0-9]+$'
          OR NOT EXISTS (
            SELECT 1
            FROM "product_listings" p
            WHERE p."listing_id" = s."target_id"::int
          )
        )
    `);

    await queryRunner.query(`
      UPDATE "share_links" s
      SET "status" = 'CANCELLED'
      WHERE s."creator_id" IS NULL
        AND s."status" = 'ACTIVE'
        AND s."target_type" = 'COLLECTION'
        AND NOT EXISTS (
          SELECT 1
          FROM "user" u
          WHERE u."id"::text = s."target_id"
        )
    `);

    await queryRunner.query(`
      UPDATE "share_links"
      SET "status" = 'CANCELLED'
      WHERE "creator_id" IS NULL
        AND "status" = 'ACTIVE'
    `);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return Promise.resolve();
    }

    return Promise.resolve();
  }
}
