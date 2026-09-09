import { QueryRunner } from 'typeorm';
import { AddOrderCreatedConsumerIdempotency1788760000000 } from '../../migrations/1788760000000-AddOrderCreatedConsumerIdempotency';

describe('Order created consumer idempotency migration contract', () => {
  it('creates commission consumption and notification delivery uniqueness', async () => {
    const statements: string[] = [];
    const runner = {
      connection: { options: { type: 'postgres' } },
      query: jest.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;

    await new AddOrderCreatedConsumerIdempotency1788760000000().up(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('"agency_order_event_consumptions"');
    expect(sql).toContain('PRIMARY KEY ("event_id")');
    expect(sql).toContain('"order_notification_deliveries"');
    expect(sql).toContain('UNIQUE ("event_id", "recipient_id")');
    expect(sql).toContain(
      "CHECK (\"status\" IN ('pending', 'sending', 'sent', 'failed', 'uncertain'))",
    );
    expect(sql).toContain('"provider_message_id" varchar(64) NULL');
    expect(sql).toContain('"chk_order_notification_delivery_receipt"');
  });
});
