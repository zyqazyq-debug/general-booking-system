import { OrderCreatedNotificationListener } from './order-created-notification.listener';

describe('OrderCreatedNotificationListener', () => {
  it('requires eventId and propagates consumer failure to the outbox', async () => {
    const notifyNewOrder = jest.fn().mockRejectedValue(new Error('uncertain'));
    const listener = new OrderCreatedNotificationListener({
      notifyNewOrder,
    } as any);

    await expect(
      listener.handleOrderCreated({
        eventId: '2cc4fbed-37f4-4e85-bf4a-10e57224686f',
        orderId: 'order-1',
        orderNo: 'O1',
        serviceId: 'service-1',
        customerId: 'consumer-1',
        providerId: 'provider-1',
        priceSnapshot: { basePrice: 100, displayPrice: 120 },
      }),
    ).rejects.toThrow('uncertain');
    expect(notifyNewOrder).toHaveBeenCalledWith(
      'order-1',
      '2cc4fbed-37f4-4e85-bf4a-10e57224686f',
    );
  });

  it('fails closed for a legacy event without eventId', async () => {
    const listener = new OrderCreatedNotificationListener({
      notifyNewOrder: jest.fn(),
    } as any);

    await expect(
      listener.handleOrderCreated({
        orderId: 'order-1',
        orderNo: 'O1',
        serviceId: 'service-1',
        customerId: 'consumer-1',
        providerId: 'provider-1',
        priceSnapshot: { basePrice: 100, displayPrice: 120 },
      }),
    ).rejects.toThrow('eventId is required');
  });
});
