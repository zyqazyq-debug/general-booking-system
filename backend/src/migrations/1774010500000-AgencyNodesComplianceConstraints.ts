import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgencyNodesComplianceConstraints1774010500000 implements MigrationInterface {
  name = 'AgencyNodesComplianceConstraints1774010500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      UPDATE "agency_nodes"
      SET
        "compliance_content" = NULLIF(BTRIM(COALESCE("compliance_content", '')), ''),
        "compliance_signature" = NULLIF(BTRIM(COALESCE("compliance_signature", '')), '')
    `);

    await queryRunner.query(`
      UPDATE "agency_nodes"
      SET "node_type" = CASE
        WHEN "compliance_content" IS NOT NULL AND "compliance_signature" IS NOT NULL
        THEN 'CONTRACT'
        ELSE 'STANDARD'
      END
      WHERE "node_type" IS NULL OR "node_type" = ''
         OR "node_type" NOT IN ('STANDARD', 'CONTRACT')
         OR ("node_type" = 'STANDARD' AND ("compliance_content" IS NOT NULL OR "compliance_signature" IS NOT NULL))
         OR ("node_type" = 'CONTRACT' AND ("compliance_content" IS NULL OR "compliance_signature" IS NULL))
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_agency_nodes_compliance_contract'
        ) THEN
          ALTER TABLE "agency_nodes"
          ADD CONSTRAINT "chk_agency_nodes_compliance_contract"
          CHECK (
            (
              "node_type" = 'STANDARD'
              AND "compliance_content" IS NULL
              AND "compliance_signature" IS NULL
            )
            OR
            (
              "node_type" = 'CONTRACT'
              AND "compliance_content" IS NOT NULL
              AND "compliance_signature" IS NOT NULL
              AND char_length("compliance_content") <= 20000
              AND char_length("compliance_signature") <= 4096
            )
          );
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
      DROP CONSTRAINT IF EXISTS "chk_agency_nodes_compliance_contract"
    `);
  }
}
