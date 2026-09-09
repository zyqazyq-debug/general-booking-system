import { randomBytes } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { CreateTelegramWebhookInbox1788730000000 } from '../../../migrations/1788730000000-CreateTelegramWebhookInbox';

describe('Telegram webhook inbox migration contract', () => {
  it('creates a fenced bigint update inbox with a processing lease index', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;

    await new CreateTelegramWebhookInbox1788730000000().up(runner);

    expect(statements.join('\n')).toContain(
      'CREATE TABLE "telegram_webhook_updates"',
    );
    expect(statements.join('\n')).toContain('"update_id" bigint PRIMARY KEY');
    expect(statements.join('\n')).toContain(
      "CHECK (\"status\" IN ('processing', 'processed'))",
    );
    expect(statements.join('\n')).toContain(
      '"lease_expires_at" timestamptz NOT NULL',
    );
    expect(statements.join('\n')).toContain(
      'IDX_telegram_webhook_updates_processing_lease',
    );
    expect(statements.join('\n')).toContain(
      'CREATE TABLE "telegram_webhook_operations"',
    );
    expect(statements.join('\n')).toContain(
      '"idempotency_key" varchar(200) PRIMARY KEY',
    );
    expect(statements.join('\n')).not.toContain('ON DELETE CASCADE');
    expect(statements.join('\n')).toContain(
      'CREATE TABLE "telegram_binding_tickets"',
    );
    expect(statements.join('\n')).toContain(
      '"token_hash" varchar(64) PRIMARY KEY',
    );
  });
});

const pgUrl = process.env.TELEGRAM_WEBHOOK_PG_TEST_URL;
const allowMutation =
  process.env.TELEGRAM_WEBHOOK_PG_TEST_ALLOW_SCHEMA_MUTATION === 'true';
const describePostgres = pgUrl && allowMutation ? describe : describe.skip;

describePostgres(
  'Telegram webhook inbox PostgreSQL migration integration',
  () => {
    let dataSource!: DataSource;
    let runner!: QueryRunner;
    const schema = `telegram_inbox_test_${randomBytes(6).toString('hex')}`;

    beforeAll(async () => {
      const databaseName = new URL(pgUrl as string).pathname.replace(/^\//, '');
      if (!/test/i.test(databaseName)) {
        throw new Error(
          'TELEGRAM_WEBHOOK_PG_TEST_URL database name must contain "test".',
        );
      }

      dataSource = new DataSource({ type: 'postgres', url: pgUrl });
      await dataSource.initialize();
      runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}"`);
    });

    afterAll(async () => {
      if (runner) {
        await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await runner.release();
      }
      if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('applies the real migration in an isolated temporary schema', async () => {
      await new CreateTelegramWebhookInbox1788730000000().up(runner);

      const columns = (await runner.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'telegram_webhook_updates'
        ORDER BY ordinal_position`,
        [schema],
      )) as Array<{ column_name: string; data_type: string }>;
      expect(columns).toEqual(
        expect.arrayContaining([
          { column_name: 'update_id', data_type: 'bigint' },
          {
            column_name: 'lease_expires_at',
            data_type: 'timestamp with time zone',
          },
          {
            column_name: 'processed_at',
            data_type: 'timestamp with time zone',
          },
        ]),
      );
    });
  },
);
