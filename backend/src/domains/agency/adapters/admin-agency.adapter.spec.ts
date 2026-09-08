import { AdminAgencyAdapter } from './admin-agency.adapter';
import { AgencyService } from '../agency.service';

describe('AdminAgencyAdapter', () => {
  it('projects collection nodes without notes or nested user secrets', async () => {
    const timestamp = new Date('2026-09-08T00:00:00.000Z');
    const agencyService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'node-id', node_type: 'STANDARD', parent_node_id: null,
          service_id: 'service-id', agent_id: 'agent-id', markup_amount: '1.25',
          cache_cost_price: '10', cache_total_price: '11.25', markup_type: 'FIXED',
          markup_value: '1.25', alias: null, inherited_name: null, share_slug: 'share',
          status: 'ACTIVE', created_at: timestamp, updated_at: timestamp,
          private_notes: 'hidden', compliance_signature: 'hidden',
          agent: { id: 'agent-id', nickname: 'Agent', phone: 'hidden' },
          service: { id: 'service-id', title: 'Consultation', is_active: true, original_notes: 'hidden' },
        },
      ]),
    } as unknown as AgencyService;

    const result = await new AdminAgencyAdapter(agencyService).findAll();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'node-id', markup_amount: 1.25, cache_cost_price: 10,
        cache_total_price: 11.25, markup_value: 1.25,
        agent: { id: 'agent-id', nickname: 'Agent' },
        service: { id: 'service-id', title: 'Consultation', is_active: true },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });
});
