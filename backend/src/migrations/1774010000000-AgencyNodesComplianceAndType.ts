import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgencyNodesComplianceAndType1774010000000 implements MigrationInterface {
  name = 'AgencyNodesComplianceAndType1774010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "compliance_content" text
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "compliance_signature" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "node_type" character varying NOT NULL DEFAULT 'STANDARD'
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'agency_nodes'
            AND column_name = 'private_note'
        ) THEN
          UPDATE "agency_nodes"
          SET "private_notes" = COALESCE(NULLIF("private_notes", ''), "private_note"::text)
          WHERE "private_note" IS NOT NULL
            AND ("private_notes" IS NULL OR "private_notes" = '');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "private_note"
    `);

    await queryRunner.query(`
      UPDATE "agency_nodes"
      SET "node_type" = CASE
        WHEN COALESCE(NULLIF("compliance_content", ''), NULL) IS NOT NULL
         AND COALESCE(NULLIF("compliance_signature", ''), NULL) IS NOT NULL
        THEN 'CONTRACT'
        ELSE 'STANDARD'
      END
      WHERE "node_type" IS NULL OR "node_type" = ''
         OR "node_type" NOT IN ('STANDARD', 'CONTRACT')
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_agency_nodes_node_type'
        ) THEN
          ALTER TABLE "agency_nodes"
          ADD CONSTRAINT "chk_agency_nodes_node_type"
          CHECK ("node_type" IN ('STANDARD', 'CONTRACT'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP CONSTRAINT IF EXISTS "chk_agency_nodes_node_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "compliance_signature"
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "compliance_content"
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "node_type"
    `);
  }
}
