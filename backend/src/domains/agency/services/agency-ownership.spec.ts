import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AgencyCollectionMutationService } from './agency-collection-mutation.service';
import { AgencyNode } from '../entities/agency-node.entity';
import { CollectionQuotaService } from '../quota/collection-quota.service';
import { AgencyTreeService } from './agency-tree.service';
import { AgencyPricingService } from './agency-pricing.service';
import { AgencyGraphService } from '../utils/agency-graph-service';

describe('AgencyCollectionMutationService - Ownership Assertions', () => {
  let service: AgencyCollectionMutationService;

  const mockAgencyRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockCollectionQuotaService = {
    assertCanActivate: jest.fn(),
  };

  const mockAgencyTreeService = {
    assertNoReparentCircular: jest.fn(),
    validateActiveChain: jest.fn(),
  };

  const mockAgencyPricingService = {
    calculateMarkupAmount: jest.fn((cost: number, _type: string, value: number) => cost * value / 100),
    calculateTotalPrice: jest.fn((cost: number, markup: number) => cost + markup),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgencyCollectionMutationService,
        {
          provide: getRepositoryToken(AgencyNode),
          useValue: mockAgencyRepository,
        },
        {
          provide: CollectionQuotaService,
          useValue: mockCollectionQuotaService,
        },
        {
          provide: AgencyTreeService,
          useValue: mockAgencyTreeService,
        },
        {
          provide: AgencyPricingService,
          useValue: mockAgencyPricingService,
        },
      ],
    }).compile();

    service = module.get<AgencyCollectionMutationService>(AgencyCollectionMutationService);
    (service as unknown as { agencyGraphService: AgencyGraphService }).agencyGraphService = {
      propagatePriceUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as AgencyGraphService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateCollection - ownership & markup guards', () => {
    it('合法：actorId === node.agent_id，修改 markup 不抛错', async () => {
      const actorId = 'agent-001';
      const nodeId = 'node-001';

      const mockNode = {
        id: nodeId,
        agent_id: actorId,
        markup_type: 'PERCENT',
        markup_value: 10,
        cache_cost_price: 100,
        markup_amount: 10,
        cache_total_price: 110,
        service: { base_price: 100 },
      } as unknown as AgencyNode;

      mockAgencyRepository.findOne
        .mockResolvedValueOnce(mockNode)
        .mockResolvedValueOnce({ ...mockNode, markup_value: 15 })
        .mockResolvedValueOnce({ ...mockNode, markup_value: 15, service: { ...mockNode.service } });

      mockAgencyRepository.save.mockImplementation((n: AgencyNode) => Promise.resolve(n));

      const result = await service.updateCollection(actorId, nodeId, {
        markup_type: 'PERCENT',
        markup_value: 15,
      });

      expect(result).toBeDefined();
      expect(mockAgencyRepository.save).toHaveBeenCalled();
    });

    it('非法：actorId 既不是 self 也不是 ancestor，修改 markup 抛 ForbiddenException', async () => {
      const actorId = 'agent-999';
      const nodeOwnerId = 'agent-001';
      const nodeId = 'node-001';

      const mockNode = {
        id: nodeId,
        agent_id: nodeOwnerId,
        markup_type: 'PERCENT',
        markup_value: 10,
        cache_cost_price: 100,
        markup_amount: 10,
        cache_total_price: 110,
        service: { base_price: 100 },
      } as unknown as AgencyNode;

      mockAgencyRepository.findOne.mockResolvedValueOnce(mockNode);

      await expect(
        service.updateCollection(actorId, nodeId, {
          markup_type: 'PERCENT',
          markup_value: 20,
        })
      ).rejects.toThrow(ForbiddenException);

      expect(mockAgencyRepository.save).not.toHaveBeenCalled();
    });

    it('非法：PERCENT 类型 markup_value=150，抛 BadRequestException (InvalidMarkupValueError)', async () => {
      const actorId = 'agent-001';
      const nodeId = 'node-001';

      const mockNode = {
        id: nodeId,
        agent_id: actorId,
        markup_type: 'PERCENT',
        markup_value: 10,
        cache_cost_price: 100,
        markup_amount: 10,
        cache_total_price: 110,
        service: { base_price: 100 },
      } as unknown as AgencyNode;

      mockAgencyRepository.findOne.mockResolvedValueOnce(mockNode);

      await expect(
        service.updateCollection(actorId, nodeId, {
          markup_type: 'PERCENT',
          markup_value: 150,
        })
      ).rejects.toThrow(BadRequestException);

      expect(mockAgencyRepository.save).not.toHaveBeenCalled();
    });
  });
});
