import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgencyPublicNotes1773830000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      ADD COLUMN IF NOT EXISTS "public_notes" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_nodes"
      DROP COLUMN IF EXISTS "public_notes"
    `);
  }
}
