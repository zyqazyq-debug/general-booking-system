import { AdminOrderAdapter } from './admin-order.adapter';
import { OrderService } from '../order.service';

describe('AdminOrderAdapter', () => {
  it('projects only the administrative read model from loaded order relations', async () => {
    const createdAt = new Date('2026-09-08T00:00:00.000Z');
    const orderService = {
      findAllForAdmin: jest.fn().mockResolvedValue([
        {
          id: 'order-id', order_no: 'ORD-1', consumer_id: 'consumer-id',
          owner_id: 'owner-id', service_id: 'service-id', agency_node_id: 'node-id',
          start_time: createdAt, end_time: createdAt, status: 'RESERVED',
          frozen_points: '3.5', display_price_snapshot: '20.00',
          created_at: createdAt, updated_at: createdAt,
          service: { id: 'service-id', title: 'Consultation', original_notes: 'hidden' },
          consumer: { id: 'consumer-id', username: 'consumer', nickname: null, phone: 'hidden' },
          agency_node: {
            id: 'node-id', share_slug: 'share', private_notes: 'hidden',
            agent: { id: 'agent-id', username: 'agent', nickname: 'Agent', email: 'hidden' },
          },
        },
      ]),
    } as unknown as OrderService;

    const result = await new AdminOrderAdapter(orderService).findAllForAdmin();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'order-id', frozen_points: 3.5, display_price_snapshot: 20,
        service: { id: 'service-id', title: 'Consultation' },
        consumer: { id: 'consumer-id', username: 'consumer', nickname: null },
        agency_node: {
          id: 'node-id', share_slug: 'share',
          agent: { id: 'agent-id', username: 'agent', nickname: 'Agent' },
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });
});
