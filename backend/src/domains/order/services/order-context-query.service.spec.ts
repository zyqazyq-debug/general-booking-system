import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderContextQueryService } from './order-context-query.service';

describe('OrderContextQueryService', () => {
  const historicalOrder = {
    id: 'order-history-1',
    consumer_id: 'consumer-1',
    owner_id: 'original-provider',
    service_id: 'service-1',
    status: OrderStatus.RESERVED,
    service: {
      id: 'service-1',
      owner_id: 'new-provider',
    },
    owner: {
      id: 'original-provider',
      nickname: 'Original Provider',
    },
    consumer: {
      id: 'consumer-1',
      nickname: 'Consumer',
    },
  } as Order;

  const orderRepository = {
    findOne: jest.fn(),
    manager: {
      find: jest.fn(),
    },
  };

  let service: OrderContextQueryService;

  beforeEach(() => {
    orderRepository.findOne.mockResolvedValue(historicalOrder);
    orderRepository.manager.find.mockResolvedValue([]);
    service = new OrderContextQueryService(
      orderRepository as unknown as Repository<Order>,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not grant a service current owner access to a historical order', async () => {
    await expect(
      service.findOneWithContext('order-history-1', 'new-provider'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the order owner snapshot authorized after service ownership changes', async () => {
    await expect(
      service.findOneWithContext('order-history-1', 'original-provider'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'order-history-1',
        context_role: 'PROVIDER',
      }),
    );
  });
});
