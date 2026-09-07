import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderLifecycleService } from './order-lifecycle.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderFinancialService } from './order-financial.service';
import { OrderStatusNotifierService } from './order-status-notifier.service';

describe('OrderLifecycleService', () => {
  let service: OrderLifecycleService;

  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      save: jest.fn(),
    },
  };

  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
  };

  const orderFinancialService = {
    unfreezeDepositCredit: jest.fn(),
    burnDepositCredit: jest.fn(),
    transferFrozenPenalty: jest.fn(),
  };

  const orderStatusNotifierService = {
    notifyStatusChange: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderLifecycleService,
        {
          provide: getRepositoryToken(Order),
          useValue: orderRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: OrderFinancialService,
          useValue: orderFinancialService,
        },
        {
          provide: OrderStatusNotifierService,
          useValue: orderStatusNotifierService,
        },
      ],
    }).compile();

    service = module.get<OrderLifecycleService>(OrderLifecycleService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('confirms pending order through provider authorization and emits status event', async () => {
    const pendingOrder = {
      id: 'order-1',
      owner_id: 'provider-2',
      consumer_id: 'consumer-1',
      status: OrderStatus.PENDING,
      service_id: 'service-1',
      service: {
        owner_id: 'provider-1',
      },
    } as Order;
    const savedOrder = {
      ...pendingOrder,
      status: OrderStatus.RESERVED,
    } as Order;

    orderRepository.findOne.mockResolvedValue(pendingOrder);
    orderRepository.save.mockResolvedValue(savedOrder);

    await expect(service.confirm('order-1', 'provider-2')).resolves.toEqual(
      savedOrder,
    );

    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-1',
        status: OrderStatus.RESERVED,
      }),
    );
    expect(orderStatusNotifierService.notifyStatusChange).toHaveBeenCalledWith({
      orderId: 'order-1',
      serviceId: 'service-1',
      oldStatus: OrderStatus.PENDING,
      newStatus: OrderStatus.RESERVED,
    });
  });

  it('completes reserved order inside transaction and emits event after commit', async () => {
    const reservedOrder = {
      id: 'order-2',
      owner_id: 'provider-2',
      consumer_id: 'consumer-2',
      status: OrderStatus.RESERVED,
      service_id: 'service-2',
      frozen_points: 30,
      metadata: null,
      service: {
        owner_id: 'provider-1',
      },
    } as Order;
    const completedOrder = {
      ...reservedOrder,
      status: OrderStatus.COMPLETED,
      metadata: {
        completed_by: 'provider-2',
        completed_role: 'PROVIDER',
      },
    } as Order;

    queryRunner.manager.findOne
      .mockResolvedValueOnce(reservedOrder)
      .mockResolvedValueOnce({ ...reservedOrder });
    queryRunner.manager.save.mockResolvedValue(completedOrder);

    await expect(service.complete('order-2', 'provider-2')).resolves.toEqual(
      completedOrder,
    );

    expect(orderFinancialService.unfreezeDepositCredit).toHaveBeenCalledWith(
      'consumer-2',
      30,
      queryRunner.manager,
    );
    expect(queryRunner.manager.save).toHaveBeenCalledWith(
      Order,
      expect.objectContaining({
        id: 'order-2',
        status: OrderStatus.COMPLETED,
        metadata: expect.objectContaining({
          completed_by: 'provider-2',
          completed_role: 'PROVIDER',
        }),
      }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(orderStatusNotifierService.notifyStatusChange).toHaveBeenCalledWith({
      orderId: 'order-2',
      serviceId: 'service-2',
      oldStatus: OrderStatus.RESERVED,
      newStatus: OrderStatus.COMPLETED,
    });
  });

  it('keeps complete operation idempotent for already completed orders', async () => {
    const completedOrder = {
      id: 'order-3',
      owner_id: 'provider-1',
      consumer_id: 'consumer-3',
      status: OrderStatus.COMPLETED,
      service_id: 'service-3',
      frozen_points: 20,
      metadata: null,
      service: {
        owner_id: 'provider-1',
      },
    } as Order;

    queryRunner.manager.findOne
      .mockResolvedValueOnce(completedOrder)
      .mockResolvedValueOnce(completedOrder);

    await expect(service.complete('order-3', 'provider-1')).resolves.toEqual(
      completedOrder,
    );

    expect(orderFinancialService.unfreezeDepositCredit).not.toHaveBeenCalled();
    expect(queryRunner.manager.save).not.toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(
      orderStatusNotifierService.notifyStatusChange,
    ).not.toHaveBeenCalled();
  });

  it('settles cancellation penalty and refund for reserved consumer cancellation', async () => {
    const order = {
      id: 'order-4',
      owner_id: 'provider-4',
      consumer_id: 'consumer-4',
      status: OrderStatus.RESERVED,
      service_id: 'service-4',
      frozen_points: 40,
      start_time: new Date(Date.now() + 10 * 60 * 1000),
      metadata: { source: 'test' },
      service: {
        owner_id: 'provider-4',
        cancellation_policy: {
          window_minutes: 30,
          penalty_percent: 25,
        },
      },
    } as unknown as Order;
    queryRunner.manager.findOne.mockResolvedValue(order);
    queryRunner.manager.save.mockImplementation(
      async (_entity: typeof Order, nextOrder: Order) => nextOrder,
    );

    const result = await service.cancel('order-4', 'consumer-4', '临时有事');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-4',
        status: OrderStatus.CANCELLED,
        metadata: expect.objectContaining({
          source: 'test',
          cancelled_by: 'consumer-4',
          cancelled_role: 'CONSUMER',
          cancellation_reason: '临时有事',
          penalty_amount: 10,
          refund_amount: 30,
        }),
      }),
    );
    expect(orderFinancialService.transferFrozenPenalty).toHaveBeenCalledWith(
      'consumer-4',
      'provider-4',
      10,
      queryRunner.manager,
    );
    expect(orderFinancialService.unfreezeDepositCredit).toHaveBeenCalledWith(
      'consumer-4',
      30,
      queryRunner.manager,
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(orderStatusNotifierService.notifyStatusChange).toHaveBeenCalledWith({
      orderId: 'order-4',
      serviceId: 'service-4',
      oldStatus: OrderStatus.RESERVED,
      newStatus: OrderStatus.CANCELLED,
    });
  });

  it('rejects no-show before the appointment grace period without burning credit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-27T10:00:00.000Z'));
    const order = {
      id: 'order-early-no-show',
      owner_id: 'provider-early',
      consumer_id: 'consumer-early',
      status: OrderStatus.RESERVED,
      service_id: 'service-early',
      frozen_points: 40,
      start_time: new Date('2026-03-27T10:30:00.000Z'),
      metadata: null,
      service: {
        owner_id: 'provider-early',
      },
    } as Order;
    queryRunner.manager.findOne.mockResolvedValue(order);

    await expect(
      service.forfeit('order-early-no-show', 'provider-early'),
    ).rejects.toThrow('Order cannot be marked no-show before the grace period');

    expect(orderFinancialService.burnDepositCredit).not.toHaveBeenCalled();
    expect(queryRunner.manager.save).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(
      orderStatusNotifierService.notifyStatusChange,
    ).not.toHaveBeenCalled();
  });
});
