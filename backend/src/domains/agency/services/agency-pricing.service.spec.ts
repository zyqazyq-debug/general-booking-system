import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgencyPricingService } from './agency-pricing.service';
import { AgencyNode } from '../entities/agency-node.entity';

describe('AgencyPricingService', () => {
  let service: AgencyPricingService;

  type AgencyGraphServiceStub = {
    propagatePriceUpdate: jest.Mock<Promise<void>, [string, number]>;
  };

  const mockAgencyRepository = {
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgencyPricingService,
        {
          provide: getRepositoryToken(AgencyNode),
          useValue: mockAgencyRepository,
        },
      ],
    }).compile();

    service = module.get<AgencyPricingService>(AgencyPricingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateMarkupAmount', () => {
    it('should support negative values (fixed)', () => {
      expect(service.calculateMarkupAmount(100, 'FIXED', -0.01)).toBe(-0.01);
    });

    it('should handle tiny percent values with 2-decimal rounding', () => {
      expect(service.calculateMarkupAmount(0.01, 'PERCENT', 0.01)).toBe(0);
    });
  });

  describe('calculateTotalPrice', () => {
    it('should handle extreme decimals correctly', () => {
      expect(service.calculateTotalPrice(0.1, 0.2)).toBe(0.3);
    });
  });

  describe('propagateScheduleUpdate', () => {
    it('should update root nodes and propagate total price downstream', async () => {
      const node = {
        id: 'node-1',
        service_id: 'service-1',
        parent_node_id: null,
        markup_type: 'PERCENT',
        markup_value: 10,
        service: { base_price: '100' },
        cache_cost_price: 0,
        cache_total_price: 0,
        markup_amount: 0,
      } as unknown as AgencyNode;

      mockAgencyRepository.find.mockResolvedValue([node]);
      mockAgencyRepository.save.mockImplementation((n: AgencyNode) =>
        Promise.resolve(n),
      );

      const propagatePriceUpdate = jest
        .fn()
        .mockResolvedValue(
          undefined,
        ) as unknown as AgencyGraphServiceStub['propagatePriceUpdate'];
      (
        service as unknown as { agencyGraphService: AgencyGraphServiceStub }
      ).agencyGraphService = { propagatePriceUpdate };

      await service.propagateScheduleUpdate('service-1');

      expect(mockAgencyRepository.find).toHaveBeenCalledTimes(1);
      expect(mockAgencyRepository.save).toHaveBeenCalledTimes(1);
      expect(node.cache_cost_price).toBe(100);
      expect(node.markup_amount).toBe(10);
      expect(node.cache_total_price).toBe(110);
      expect(propagatePriceUpdate).toHaveBeenCalledWith('node-1', 110);
    });

    it('should keep totals stable for tiny base prices', async () => {
      const node = {
        id: 'node-2',
        service_id: 'service-2',
        parent_node_id: null,
        markup_type: 'PERCENT',
        markup_value: 10,
        service: { base_price: '0.0001' },
        cache_cost_price: 0,
        cache_total_price: 0,
        markup_amount: 0,
      } as unknown as AgencyNode;

      mockAgencyRepository.find.mockResolvedValue([node]);
      mockAgencyRepository.save.mockImplementation((n: AgencyNode) =>
        Promise.resolve(n),
      );

      const propagatePriceUpdate = jest
        .fn()
        .mockResolvedValue(
          undefined,
        ) as unknown as AgencyGraphServiceStub['propagatePriceUpdate'];
      (
        service as unknown as { agencyGraphService: AgencyGraphServiceStub }
      ).agencyGraphService = { propagatePriceUpdate };

      await service.propagateScheduleUpdate('service-2');

      expect(node.cache_cost_price).toBe(0.0001);
      expect(node.markup_amount).toBe(0);
      expect(node.cache_total_price).toBe(0);
      expect(propagatePriceUpdate).toHaveBeenCalledWith('node-2', 0);
    });
  });
});
