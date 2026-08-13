﻿﻿﻿﻿﻿import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderFinancialService } from './order-financial.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { ORDER_USERS_PORT, ORDER_SERVICES_PORT } from '../ports/tokens';
import { User } from '../../users';

describe('OrderFinancialService', () => {
  let service: OrderFinancialService;

  const mockOrderRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockUsersPort = {
    findUserById: jest.fn(),
    freezeCredit: jest.fn(),
    unfreezeCredit: jest.fn(),
    burnCredit: jest.fn(),
    transferFrozenCredit: jest.fn(),
  };

  const mockServicesPort = {
    findServiceById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderFinancialService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository,
        },
        {
          provide: ORDER_USERS_PORT,
          useValue: mockUsersPort,
        },

        {
          provide: ORDER_SERVICES_PORT,
          useValue: mockServicesPort,
        },
      ],
    }).compile();

    service = module.get<OrderFinancialService>(OrderFinancialService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCreditSummary', () => {
    it('should calculate credit summary correctly for a given user', async () => {
      const mockUser = {
        id: 'user-1',
        credit_balance: '100',
      } as unknown as User;

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          frozen_total: '45.00',
          reserved_count: '2',
        }),
      };

      mockOrderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getCreditSummary(mockUser);

      expect(result).toEqual({
        available_credit: 100,
        frozen_total: 45,
        active_reserved_orders: 2,
        credit_total: 145,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });

      expect(mockOrderRepository.createQueryBuilder).toHaveBeenCalledWith(
        'order',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'order.consumer_id = :userId',
        { userId: 'user-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'order.status = :status',
        { status: OrderStatus.RESERVED },
      );
    });

    it('should handle null values from database gracefully', async () => {
      const mockUser = {
        id: 'user-2',
        credit_balance: null,
      } as unknown as User;

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
      };

      mockOrderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getCreditSummary(mockUser);

      expect(result).toEqual({
        available_credit: 0,
        frozen_total: 0,
        active_reserved_orders: 0,
        credit_total: 0,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });

    it('should fetch user if string ID is provided', async () => {
      const mockUser = {
        id: 'user-3',
        credit_balance: '50',
      } as unknown as User;
      mockUsersPort.findUserById.mockResolvedValue(mockUser);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest
          .fn()
          .mockResolvedValue({ frozen_total: '5', reserved_count: '1' }),
      };
      mockOrderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getCreditSummary('user-3');

      expect(mockUsersPort.findUserById).toHaveBeenCalledWith('user-3');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'order.consumer_id = :userId',
        { userId: 'user-3' },
      );
    });
  });

  describe('checkCreditForService', () => {
    it('should determine if user can book service and calculate shortfall', async () => {
      mockUsersPort.findUserById.mockResolvedValue({
        id: 'user-1',
        credit_balance: '30',
      });
      mockServicesPort.findServiceById.mockResolvedValue({
        id: 'service-1',
        deposit_points: '50',
      });

      const result = await service.checkCreditForService('user-1', 'service-1');

      expect(result).toEqual({
        can_book: false,
        required_credit: 50,
        available_credit: 30,
        shortfall: 20,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });

    it('should handle zero credit requirements and balances', async () => {
      mockUsersPort.findUserById.mockResolvedValue({
        id: 'user-empty',
        credit_balance: '0',
      });
      mockServicesPort.findServiceById.mockResolvedValue({
        id: 'service-free',
        deposit_points: '0',
      });

      const result = await service.checkCreditForService(
        'user-empty',
        'service-free',
      );

      expect(result).toEqual({
        can_book: true,
        required_credit: 0,
        available_credit: 0,
        shortfall: 0,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });

    it('should handle extreme decimal differences correctly (prevent floating point bugs)', async () => {
      mockUsersPort.findUserById.mockResolvedValue({
        id: 'user-decimal',
        credit_balance: '10.32',
      });
      mockServicesPort.findServiceById.mockResolvedValue({
        id: 'service-decimal',
        deposit_points: '10.33',
      });

      const result = await service.checkCreditForService(
        'user-decimal',
        'service-decimal',
      );

      // 10.33 - 10.32 = 0.0100000000000016
      // should format to 0.01
      expect(result).toEqual({
        can_book: false,
        required_credit: 10.33,
        available_credit: 10.32,
        shortfall: 0.01,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });

    it('should handle negative balances (e.g. penalized user)', async () => {
      mockServicesPort.findServiceById.mockResolvedValue({
        id: 'service-neg',
        deposit_points: '10',
      });
      mockUsersPort.findUserById.mockResolvedValue({
        id: 'user-neg',
        credit_balance: '-5',
      });

      const result = await service.checkCreditForService(
        'user-neg',
        'service-neg',
      );

      expect(result).toEqual({
        can_book: false,
        required_credit: 10,
        available_credit: -5,
        shortfall: 15,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });

    it('should return can_book true when credit is sufficient', async () => {
      mockUsersPort.findUserById.mockResolvedValue({
        id: 'user-2',
        credit_balance: '100',
      });
      mockServicesPort.findServiceById.mockResolvedValue({
        id: 'service-2',
        deposit_points: '50',
      });

      const result = await service.checkCreditForService('user-2', 'service-2');

      expect(result).toEqual({
        can_book: true,
        required_credit: 50,
        available_credit: 100,
        shortfall: 0,
        purchase_endpoint: '/users/me/credit/purchase-intent',
      });
    });
  });
});
