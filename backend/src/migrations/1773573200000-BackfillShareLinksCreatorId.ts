import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillShareLinksCreatorId1773573200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      UPDATE "share_links" s
      SET "creator_id" = p."owner_id"
      FROM "product_listings" p
      WHERE s."creator_id" IS NULL
        AND s."target_type" = 'SINGLE'
        AND s."target_id" ~ '^[0-9]+$'
        AND p."listing_id" = s."target_id"::int
    `);

    await queryRunner.query(`
      UPDATE "share_links" s
      SET "creator_id" = u."id"
      FROM "user" u
      WHERE s."creator_id" IS NULL
        AND s."target_type" = 'COLLECTION'
        AND s."target_id" = u."id"::text
    `);

    await queryRunner.query(`
      WITH batch_owner AS (
        SELECT
          s."id",
          (ARRAY_AGG(DISTINCT p."owner_id"))[1] AS "owner_id",
          COUNT(DISTINCT p."owner_id") AS "owner_count"
        FROM "share_links" s
        JOIN LATERAL jsonb_array_elements_text(s."payload"::jsonb) j(value) ON true
        JOIN "product_listings" p
          ON j.value ~ '^[0-9]+$'
         AND p."listing_id" = j.value::int
        WHERE s."creator_id" IS NULL
          AND s."target_type" = 'BATCH'
        GROUP BY s."id"
      )
      UPDATE "share_links" s
      SET "creator_id" = b."owner_id"
      FROM batch_owner b
      WHERE s."id" = b."id"
        AND b."owner_count" = 1
    `);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return Promise.resolve();
    }

    return Promise.resolve();
  }
}
