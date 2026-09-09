import { QueryRunner } from 'typeorm';
import { AddOrderSourceIdempotencyKey1788740000000 } from '../../migrations/1788740000000-AddOrderSourceIdempotencyKey';

describe('Order source idempotency migration contract', () => {
  it('adds a nullable source key and a partial unique index', async () => {
    const statements: string[] = [];
    const runner = {
      connection: { options: { type: 'postgres' } },
      query: jest.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;

    await new AddOrderSourceIdempotencyKey1788740000000().up(runner);

    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'ADD COLUMN IF NOT EXISTS "source_idempotency_key" varchar(191) NULL',
        ),
        expect.stringContaining(
          'CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_source_idempotency_key"',
        ),
      ]),
    );
    expect(statements.join('\n')).toContain(
      'WHERE "source_idempotency_key" IS NOT NULL',
    );
  });
});
