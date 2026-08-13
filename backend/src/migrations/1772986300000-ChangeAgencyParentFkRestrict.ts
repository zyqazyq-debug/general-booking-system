import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeAgencyParentFkRestrict1772986300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DO $$
            DECLARE
              fk_name text;
            BEGIN
              SELECT tc.constraint_name INTO fk_name
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
              WHERE tc.table_name = 'agency_nodes'
                AND tc.constraint_type = 'FOREIGN KEY'
                AND kcu.column_name = 'parent_node_id'
              LIMIT 1;

              IF fk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE "agency_nodes" DROP CONSTRAINT %I', fk_name);
              END IF;
            END $$;
        `);

    await queryRunner.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_agency_nodes_parent_node_id'
              ) THEN
                ALTER TABLE "agency_nodes"
                ADD CONSTRAINT "fk_agency_nodes_parent_node_id"
                FOREIGN KEY ("parent_node_id")
                REFERENCES "agency_nodes"("id")
                ON DELETE RESTRICT
                ON UPDATE NO ACTION;
              END IF;
            END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "agency_nodes"
            DROP CONSTRAINT IF EXISTS "fk_agency_nodes_parent_node_id"
        `);

    await queryRunner.query(`
            ALTER TABLE "agency_nodes"
            ADD CONSTRAINT "fk_agency_nodes_parent_node_id"
            FOREIGN KEY ("parent_node_id")
            REFERENCES "agency_nodes"("id")
            ON DELETE SET NULL
            ON UPDATE NO ACTION
        `);
  }
}
