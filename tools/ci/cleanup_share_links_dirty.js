const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../backend/.env') });
const { Client } = require(path.join(
  __dirname,
  '../../backend/node_modules/pg',
));

async function run() {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  await client.connect();
  try {
    const backfillSingle = await client.query(`
      UPDATE "share_links" s
      SET "creator_id" = p."owner_id"
      FROM "product_listings" p
      WHERE s."creator_id" IS NULL
        AND s."target_type" = 'SINGLE'
        AND s."target_id" ~ '^[0-9]+$'
        AND p."listing_id" = s."target_id"::int
    `);

    const backfillCollection = await client.query(`
      UPDATE "share_links" s
      SET "creator_id" = u."id"
      FROM "user" u
      WHERE s."creator_id" IS NULL
        AND s."target_type" = 'COLLECTION'
        AND s."target_id" = u."id"::text
    `);

    const backfillBatch = await client.query(`
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

    const cancelDirty = await client.query(`
      UPDATE "share_links"
      SET "status" = 'CANCELLED'
      WHERE "creator_id" IS NULL
        AND "status" = 'ACTIVE'
    `);

    const stat = await client.query(`
      SELECT
        COUNT(*)::int AS total_null,
        COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::int AS active_null,
        COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::int AS cancelled_null
      FROM "share_links"
      WHERE "creator_id" IS NULL
    `);

    console.log(`backfill_single=${backfillSingle.rowCount}`);
    console.log(`backfill_collection=${backfillCollection.rowCount}`);
    console.log(`backfill_batch=${backfillBatch.rowCount}`);
    console.log(`cancelled_dirty=${cancelDirty.rowCount}`);
    console.log(`total_null=${stat.rows[0].total_null}`);
    console.log(`active_null=${stat.rows[0].active_null}`);
    console.log(`cancelled_null=${stat.rows[0].cancelled_null}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(`CLEANUP_FAILED=${error.message}`);
  process.exit(1);
});
