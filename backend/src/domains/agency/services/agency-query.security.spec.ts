import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AgencyNode } from '../entities/agency-node.entity';
import { AgencyQueryService } from './agency-query.service';

describe('AgencyQueryService security projections', () => {
  let service: AgencyQueryService;
  const repository = { findOne: jest.fn() };

  const node = {
    id: 'node-1',
    agent_id: 'owner-1',
    parent_node_id: null,
    service_id: 'service-1',
    status: 'ACTIVE',
    alias: 'Public title',
    inherited_name: null,
    share_slug: 'safe-slug',
    private_notes: '说明：must never become public',
    public_notes: 'Public description',
    compliance_content: 'secret contract',
    compliance_signature: 'secret signature',
    cache_cost_price: 80,
    cache_total_price: 120,
    markup_type: 'PERCENT',
    markup_value: 50,
    markup_amount: 40,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    service: {
      id: 'service-1',
      title: 'Original title',
      duration_minutes: 30,
      deposit_points: 10,
      buffer_minutes: 5,
      rules: { cancellation: '24h' },
      base_price: 80,
      is_active: true,
    },
    agent: { id: 'owner-1', nickname: 'Owner', avatar: 'avatar.png' },
  } as unknown as AgencyNode;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgencyQueryService,
        { provide: getRepositoryToken(AgencyNode), useValue: repository },
      ],
    }).compile();
    service = module.get(AgencyQueryService);
    repository.findOne.mockResolvedValue(node);
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects a node lookup by a non-owner actor', async () => {
    await expect(
      service.findByIdForActor('node-1', 'intruder'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an explicit safe projection to the owning actor', async () => {
    const result = await service.findByIdForActor('node-1', 'owner-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'node-1',
        status: 'ACTIVE',
        share_slug: 'safe-slug',
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private_notes|compliance_|cache_cost|cache_total|markup_|cost_price|provider_base_price/,
    );
  });

  it('never derives a public description from private notes', async () => {
    repository.findOne.mockResolvedValue({
      ...node,
      public_notes: null,
    });

    const result = await service.findBySlug('safe-slug');

    expect(result.service.description).toBe('');
    expect(JSON.stringify(result)).not.toMatch(
      /private_notes|compliance_|cache_cost|cache_total|markup_|cost_price|provider_base_price/,
    );
  });

  it.each([
    { status: 'INACTIVE', serviceActive: true },
    { status: 'DELETED', serviceActive: true },
    { status: 'ACTIVE', serviceActive: false },
  ])(
    'fails closed for unavailable public nodes: %o',
    async ({ status, serviceActive }) => {
      repository.findOne.mockResolvedValue({
        ...node,
        status,
        service: { ...node.service, is_active: serviceActive },
      });

      await expect(service.findBySlug('safe-slug')).rejects.toThrow(
        'Agency node is unavailable',
      );
    },
  );
});
