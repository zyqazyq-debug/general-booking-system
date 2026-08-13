import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotesToServiceBlock1772952082018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_blocks" ADD COLUMN IF NOT EXISTS "description" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_blocks" ADD COLUMN IF NOT EXISTS "notes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_blocks" DROP COLUMN IF EXISTS "notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_blocks" DROP COLUMN IF EXISTS "description"`,
    );
  }
}
