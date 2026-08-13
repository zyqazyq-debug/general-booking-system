import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAgencyNodeUniqueIndex1774200000002 implements MigrationInterface {
  name = 'RemoveAgencyNodeUniqueIndex1774200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_agency_unique_root"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_agency_unique_child"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agency_unique_root" ON "agency_nodes" ("agent_id", "service_id") WHERE parent_node_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agency_unique_child" ON "agency_nodes" ("agent_id", "service_id", "parent_node_id") WHERE parent_node_id IS NOT NULL`,
    );
  }
}
