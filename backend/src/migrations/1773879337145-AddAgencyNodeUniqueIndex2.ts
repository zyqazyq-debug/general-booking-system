import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgencyNodeUniqueIndex21773879337145 implements MigrationInterface {
  name = 'AddAgencyNodeUniqueIndex21773879337145';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // We have complex recursive dependencies or chains of duplicates.
    // ID: 2c60599a-494b-4483-b19a-8d2b031613c0 is failing to delete.
    // It is still referenced by "agency_nodes".

    // This implies that my update query:
    // UPDATE agency_nodes SET parent_node_id = rd.kept_id FROM root_dups rd WHERE agency_nodes.parent_node_id = rd.duplicate_id
    // ... did NOT clear all references to this ID.

    // Why?
    // 1. Is 'parent_node_id' the ONLY foreign key from agency_nodes to itself?
    // Let's check the Entity.
    // Yes: @ManyToOne(() => AgencyNode) parent_node;

    // 2. Are there multiple duplicates for the same key?
    // My query: SELECT a.id AS duplicate_id, b.id AS kept_id ... WHERE a.id > b.id
    // If we have 3 duplicates: 1, 2, 3.
    // 3 > 2, 3 > 1, 2 > 1.
    // The join will produce pairs: (3, 2), (3, 1), (2, 1).
    // If we put all these in 'root_dups' table:
    // duplicate_id | kept_id
    // 3            | 2
    // 3            | 1
    // 2            | 1

    // When we update children of 3:
    // UPDATE ... SET parent_node_id = kept_id ...
    // If we have multiple rows for duplicate_id=3, which kept_id is used?
    // Postgres says: "If a row is updated more than once ... only one of the updates is performed."
    // So children of 3 might be moved to 2 OR 1.

    // When we try to DELETE 3:
    // It works because children moved away.

    // When we try to DELETE 2:
    // It is a duplicate of 1.
    // BUT, 2 might have become the parent of 3's children!
    // If children of 3 were moved to 2.
    // Then we try to delete 2.
    // We need to move children of 2 (including the ones we just moved from 3) to 1.

    // This chain dependency is the problem.
    // We need to resolve the "ultimate kept ID" for each duplicate.
    // i.e., for any group of duplicates, pick the MIN(id) as the master.
    // All others are duplicates.
    // All children of ANY duplicate should point to the master.

    // Revised Strategy:
    // 1. Group by (agent_id, service_id).
    // 2. Pick MIN(id) as master_id.
    // 3. Update ALL nodes where parent_node_id IN (other_ids) to set parent_node_id = master_id.
    // 4. Delete (other_ids).

    // PASS 1: Root Nodes
    await queryRunner.query(`
            CREATE TEMP TABLE root_clusters AS
            SELECT agent_id, service_id, MIN(id::text)::uuid as master_id
            FROM agency_nodes
            WHERE parent_node_id IS NULL
            GROUP BY agent_id, service_id
            HAVING COUNT(*) > 1
        `);

    await queryRunner.query(
      `CREATE INDEX idx_rc_master ON root_clusters(agent_id, service_id)`,
    );

    // Identify duplicates
    await queryRunner.query(`
            CREATE TEMP TABLE root_duplicates AS
            SELECT n.id as duplicate_id, c.master_id
            FROM agency_nodes n
            JOIN root_clusters c ON n.agent_id = c.agent_id AND n.service_id = c.service_id
            WHERE n.parent_node_id IS NULL AND n.id != c.master_id
        `);

    await queryRunner.query(
      `CREATE INDEX idx_rd_dup ON root_duplicates(duplicate_id)`,
    );

    // Update references to point to master
    await queryRunner.query(`
            UPDATE agency_nodes
            SET parent_node_id = rd.master_id
            FROM root_duplicates rd
            WHERE agency_nodes.parent_node_id = rd.duplicate_id
        `);

    // Update share_links
    const hasShareLinks = await queryRunner.hasTable('share_links');
    if (
      hasShareLinks &&
      (await queryRunner.hasColumn('share_links', 'agency_node_id'))
    ) {
      await queryRunner.query(`
                UPDATE share_links
                SET agency_node_id = rd.master_id
                FROM root_duplicates rd
                WHERE share_links.agency_node_id = rd.duplicate_id
            `);
    }

    // Update commission_records
    const hasCommissionRecords =
      await queryRunner.hasTable('commission_records');
    if (
      hasCommissionRecords &&
      (await queryRunner.hasColumn('commission_records', 'agency_node_id'))
    ) {
      await queryRunner.query(`
                UPDATE commission_records
                SET agency_node_id = rd.master_id
                FROM root_duplicates rd
                WHERE commission_records.agency_node_id = rd.duplicate_id
            `);
    }

    // Delete duplicates
    await queryRunner.query(`
            DELETE FROM agency_nodes
            WHERE id IN (SELECT duplicate_id FROM root_duplicates)
        `);

    await queryRunner.query(`DROP TABLE root_duplicates`);
    await queryRunner.query(`DROP TABLE root_clusters`);

    // PASS 2: Child Nodes
    // Note: Group by (agent_id, service_id, parent_node_id)

    await queryRunner.query(`
            CREATE TEMP TABLE child_clusters AS
            SELECT agent_id, service_id, parent_node_id, MIN(id::text)::uuid as master_id
            FROM agency_nodes
            WHERE parent_node_id IS NOT NULL
            GROUP BY agent_id, service_id, parent_node_id
            HAVING COUNT(*) > 1
        `);

    // Note: No index on multiple columns for temp table needed strictly, but helps.

    await queryRunner.query(`
            CREATE TEMP TABLE child_duplicates AS
            SELECT n.id as duplicate_id, c.master_id
            FROM agency_nodes n
            JOIN child_clusters c 
              ON n.agent_id = c.agent_id 
              AND n.service_id = c.service_id 
              AND n.parent_node_id = c.parent_node_id
            WHERE n.id != c.master_id
        `);

    await queryRunner.query(
      `CREATE INDEX idx_cd_dup ON child_duplicates(duplicate_id)`,
    );

    // Update references (Grandchildren)
    await queryRunner.query(`
            UPDATE agency_nodes
            SET parent_node_id = cd.master_id
            FROM child_duplicates cd
            WHERE agency_nodes.parent_node_id = cd.duplicate_id
        `);

    if (
      hasShareLinks &&
      (await queryRunner.hasColumn('share_links', 'agency_node_id'))
    ) {
      await queryRunner.query(`
                UPDATE share_links
                SET agency_node_id = cd.master_id
                FROM child_duplicates cd
                WHERE share_links.agency_node_id = cd.duplicate_id
            `);
    }

    if (
      hasCommissionRecords &&
      (await queryRunner.hasColumn('commission_records', 'agency_node_id'))
    ) {
      await queryRunner.query(`
                UPDATE commission_records
                SET agency_node_id = cd.master_id
                FROM child_duplicates cd
                WHERE commission_records.agency_node_id = cd.duplicate_id
            `);
    }

    // Delete duplicates
    await queryRunner.query(`
            DELETE FROM agency_nodes
            WHERE id IN (SELECT duplicate_id FROM child_duplicates)
        `);

    await queryRunner.query(`DROP TABLE child_duplicates`);
    await queryRunner.query(`DROP TABLE child_clusters`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agency_unique_root" ON "agency_nodes" ("agent_id", "service_id") WHERE parent_node_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_agency_unique_child" ON "agency_nodes" ("agent_id", "service_id", "parent_node_id") WHERE parent_node_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_agency_unique_child"`);
    await queryRunner.query(`DROP INDEX "public"."idx_agency_unique_root"`);
  }
}
