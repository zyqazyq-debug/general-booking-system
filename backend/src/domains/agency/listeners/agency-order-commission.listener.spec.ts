/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { AgencyOrderCommissionListener } from './agency-order-commission.listener';

describe('AgencyOrderCommissionListener', () => {
  it('should calculate A->B commissions along parent_node_id chain', async () => {
    const agencyQueryService = {
      findById: jest.fn(async (id: string) => {
        if (id === 'node-b') {
          return {
            id: 'node-b',
            agent_id: 'user-b',
            parent_node_id: 'node-a',
            markup_type: 'FIXED',
            markup_value: 20,
          } as any;
        }
        if (id === 'node-a') {
          return {
            id: 'node-a',
            agent_id: 'user-a',
            parent_node_id: null,
            markup_type: 'FIXED',
            markup_value: 0,
          } as any;
        }
        return null;
      }),
    } as any;

    const saved: any[] = [];
    const commissionRepository = {
      create: jest.fn((payload: any) => payload),
      save: jest.fn(async (payload: any) => {
        saved.push(payload);
        return payload;
      }),
    } as any;

    const listener = new AgencyOrderCommissionListener(
      agencyQueryService,
      commissionRepository,
    );

    await listener.handleOrderCreated({
      orderId: 'order-1',
      orderNo: 'ORDER-001',
      serviceId: 'svc-1',
      agencyNodeId: 'node-b',
      customerId: 'user-c',
      providerId: 'user-a',
      priceSnapshot: {
        basePrice: 100,
        displayPrice: 120,
      },
    });

    expect(agencyQueryService.findById).toHaveBeenCalledWith('node-b');
    expect(agencyQueryService.findById).toHaveBeenCalledWith('node-a');
    expect(saved).toHaveLength(2);

    const provider = saved[0];
    expect(provider.role).toBe('PROVIDER');
    expect(provider.agent_id).toBe('user-a');
    expect(Number(provider.cost_price)).toBe(0);
    expect(Number(provider.markup_amount)).toBe(100);
    expect(Number(provider.final_price)).toBe(100);
    expect(provider.child_agent_id).toBe('user-b');
    expect(provider.level).toBe(0);

    const agentB = saved[1];
    expect(agentB.role).toBe('AGENT');
    expect(agentB.agent_id).toBe('user-b');
    expect(Number(agentB.cost_price)).toBe(100);
    expect(Number(agentB.markup_amount)).toBe(20);
    expect(Number(agentB.final_price)).toBe(120);
    expect(agentB.child_agent_id).toBeNull();
    expect(agentB.level).toBe(1);
  });
});
