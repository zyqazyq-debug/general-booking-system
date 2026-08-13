import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacyShareLinksAndAgentLinks1774200000000 implements MigrationInterface {
  name = 'DropLegacyShareLinksAndAgentLinks1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "agent_links" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "share_links" CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await Promise.resolve();
    void queryRunner;
  }
}
