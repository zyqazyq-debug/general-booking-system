import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxShareLinksCreatorIdNullable1773572600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "share_links"
      ALTER COLUMN "creator_id" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "share_links"
      ALTER COLUMN "creator_id" SET NOT NULL
    `);
  }
}
