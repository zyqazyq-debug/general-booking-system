import { QueryRunner } from 'typeorm';
import { CreateOrderOutbox1788750000000 } from '../../migrations/1788750000000-CreateOrderOutbox';

describe('Order outbox migration contract', () => {
  it('creates a durable uniquely keyed event queue with lease indexes', async () => {
    const statements: string[] = [];
    const runner = {
      connection: { options: { type: 'postgres' } },
      query: jest.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;

    await new CreateOrderOutbox1788750000000().up(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "order_outbox_events"');
    expect(sql).toContain(
      'CONSTRAINT "uq_order_outbox_idempotency_key" UNIQUE ("idempotency_key")',
    );
    expect(sql).toContain(
      "CHECK (\"status\" IN ('pending', 'processing', 'processed'))",
    );
    expect(sql).toContain('idx_order_outbox_processing_lease');
    expect(sql).toContain('idx_order_outbox_dispatch');
  });
});
