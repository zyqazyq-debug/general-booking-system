import { MigrationInterface, QueryRunner } from 'typeorm';

export class MergeAgentIntoAgencyNodes1773906000000 implements MigrationInterface {
  name = 'MergeAgentIntoAgencyNodes1773906000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "node_type" character varying NOT NULL DEFAULT 'STANDARD'
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "private_note" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "compliance_content" text
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "compliance_signature" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "agency_node_id" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_orders_agency_node'
        ) THEN
          ALTER TABLE "orders"
          ADD CONSTRAINT "fk_orders_agency_node"
          FOREIGN KEY ("agency_node_id")
          REFERENCES "agency_nodes"("id")
          ON DELETE SET NULL
          ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
          WHERE t.relname = 'orders'
            AND a.attname = 'agent_link_id'
        ) LOOP
          EXECUTE format('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS %I', r.conname);
        END LOOP;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "agent_link_id"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "agent_links"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token" character varying NOT NULL,
        "agent_id" character varying NOT NULL,
        "service_id" character varying NOT NULL,
        "parent_link_id" character varying,
        "markup_type" character varying NOT NULL DEFAULT 'PERCENT',
        "markup_value" numeric(10,2) NOT NULL DEFAULT '0',
        "private_note" character varying,
        "compliance_content" text,
        "compliance_signature" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_links_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "agent_link_id" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_orders_agent_link'
        ) THEN
          ALTER TABLE "orders"
          ADD CONSTRAINT "fk_orders_agent_link"
          FOREIGN KEY ("agent_link_id")
          REFERENCES "agent_links"("id")
          ON DELETE SET NULL
          ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT c.conname
          FROM pg_constraint c
          WHERE c.conname = 'fk_orders_agency_node'
        ) LOOP
          EXECUTE format('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS %I', r.conname);
        END LOOP;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "agency_node_id"
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
      DROP COLUMN IF EXISTS "private_note"
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "node_type"
    `);
  }
}
