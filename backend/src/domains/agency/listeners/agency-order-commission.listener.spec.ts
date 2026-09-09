/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryFailedError } from 'typeorm';
import { AgencyOrderCommissionListener } from './agency-order-commission.listener';

describe('AgencyOrderCommissionListener durable consumption', () => {
  const event = {
    eventId: '2cc4fbed-37f4-4e85-bf4a-10e57224686f',
    orderId: 'order-1',
    orderNo: 'ORDER-001',
    serviceId: 'svc-1',
    agencyNodeId: 'node-b',
    customerId: 'user-c',
    providerId: 'user-a',
    priceSnapshot: { basePrice: 100, displayPrice: 120 },
  };

  function buildSubject(options?: { failFirstSave?: boolean }) {
    const agencyQueryService = {
      findInternalSnapshotById: jest.fn(async (id: string) => {
        if (id === 'node-b') {
          return {
            agent_id: 'user-b',
            parent_node_id: 'node-a',
            markup_type: 'FIXED',
            markup_value: 20,
          };
        }
        if (id === 'node-a') {
          return {
            agent_id: 'user-a',
            parent_node_id: null,
            markup_type: 'FIXED',
            markup_value: 0,
          };
        }
        return null;
      }),
    };
    const commissionRepository = {
      create: jest.fn((payload: unknown) => payload),
    };
    const processed = new Set<string>();
    const saved: any[] = [];
    let failFirstSave = options?.failFirstSave ?? false;
    let transactionTail = Promise.resolve();
    const dataSource = {
      transaction: jest.fn(async (work: (manager: any) => Promise<void>) => {
        const predecessor = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await predecessor;
        const stagedEvents = new Set<string>();
        const stagedRecords: any[] = [];
        const manager = {
          insert: jest.fn(
            async (_entity: unknown, row: { event_id: string }) => {
              if (processed.has(row.event_id)) {
                throw new QueryFailedError('INSERT', [], {
                  code: 'SQLITE_CONSTRAINT',
                  errno: 19,
                  message:
                    'UNIQUE constraint failed: agency_order_event_consumptions.event_id',
                });
              }
              stagedEvents.add(row.event_id);
            },
          ),
          save: jest.fn(async (_entity: unknown, row: unknown) => {
            if (failFirstSave) {
              failFirstSave = false;
              throw new Error('commission write failed');
            }
            stagedRecords.push(row);
            return row;
          }),
        };
        try {
          await work(manager);
          stagedEvents.forEach((id) => processed.add(id));
          saved.push(...stagedRecords);
        } finally {
          release();
        }
      }),
    };

    return {
      listener: new AgencyOrderCommissionListener(
        agencyQueryService as any,
        commissionRepository as any,
        dataSource as any,
      ),
      saved,
      processed,
    };
  }

  it('commits the event receipt and full commission chain once', async () => {
    const { listener, saved, processed } = buildSubject();

    await listener.handleOrderCreated(event);
    await listener.handleOrderCreated(event);

    expect(processed).toEqual(new Set([event.eventId]));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      role: 'PROVIDER',
      agent_id: 'user-a',
      final_price: 100,
      level: 0,
    });
    expect(saved[1]).toMatchObject({
      role: 'AGENT',
      agent_id: 'user-b',
      final_price: 120,
      level: 1,
    });
  });

  it('admits only one commission transaction when duplicate events overlap', async () => {
    const { listener, saved } = buildSubject();

    await Promise.all([
      listener.handleOrderCreated(event),
      listener.handleOrderCreated(event),
    ]);

    expect(saved).toHaveLength(2);
  });

  it('rolls back the receipt with failed commission writes and recovers on replay', async () => {
    const { listener, saved, processed } = buildSubject({
      failFirstSave: true,
    });

    await expect(listener.handleOrderCreated(event)).rejects.toThrow(
      'commission write failed',
    );
    expect(processed.size).toBe(0);
    expect(saved).toHaveLength(0);

    await expect(listener.handleOrderCreated(event)).resolves.toBeUndefined();
    expect(processed).toEqual(new Set([event.eventId]));
    expect(saved).toHaveLength(2);
  });

  it('fails closed for legacy events without a durable eventId', async () => {
    const { listener } = buildSubject();
    const { eventId: _eventId, ...legacy } = event;

    await expect(listener.handleOrderCreated(legacy)).rejects.toThrow(
      'eventId is required',
    );
  });
});
