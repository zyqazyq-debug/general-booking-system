import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenAuthSessionsAndIdentityProofs1788700000000 implements MigrationInterface {
  name = 'HardenAuthSessionsAndIdentityProofs1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "auth_version" integer NOT NULL DEFAULT 1`,
    );

    // Legacy rows contain reusable raw JWTs. Revoking them is the safe upgrade.
    await queryRunner.query(`DELETE FROM "user_tokens"`);
    await queryRunner.query(
      `ALTER TABLE "user_tokens" RENAME COLUMN "token" TO "token_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" ALTER COLUMN "token_hash" TYPE varchar(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" ADD COLUMN "session_id" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" ADD COLUMN "revoked_at" timestamp NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_tokens_session_id" ON "user_tokens" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_tokens_token_hash" ON "user_tokens" ("token_hash")`,
    );

    await queryRunner.query(`
      CREATE TABLE "consumed_identity_proofs" (
        "proof_hash" varchar(64) PRIMARY KEY,
        "provider" varchar(16) NOT NULL,
        "subject_hash" varchar(64) NOT NULL,
        "actor_id" uuid NULL,
        "expires_at" timestamp NOT NULL,
        "consumed_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_consumed_identity_proofs_expires_at" ON "consumed_identity_proofs" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_consumed_identity_proofs_expires_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "consumed_identity_proofs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_tokens_session_id"`);
    await queryRunner.query(
      `ALTER TABLE "user_tokens" DROP COLUMN "revoked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" DROP COLUMN "session_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" RENAME COLUMN "token_hash" TO "token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tokens" ALTER COLUMN "token" TYPE varchar(512)`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "auth_version"`);
  }
}
