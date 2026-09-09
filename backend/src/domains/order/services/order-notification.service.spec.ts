/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataSource } from 'typeorm';
import { OrderNotificationService } from './order-notification.service';
import {
  ORDER_NOTIFICATION_SENT,
  ORDER_NOTIFICATION_UNCERTAIN,
  OrderNotificationDelivery,
} from '../outbox/order-notification-delivery.entity';
import {
  OrderNotificationDeliveryService,
  OrderNotificationDeliveryUncertainError,
} from '../outbox/order-notification-delivery.service';

describe('OrderNotificationService durable order-created delivery', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [OrderNotificationDelivery],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('does not resend the successful recipient when another recipient is uncertain', async () => {
    const order = {
      id: 'order-1',
      order_no: 'O1',
      service_id: 'service-1',
      service_snapshot: {
        title: 'Consultation',
        duration_minutes: 60,
        base_price: 100,
      },
      agency_node_id: null,
      consumer_id: 'consumer-1',
      owner_id: 'provider-1',
      start_time: new Date('2026-09-10T02:00:00.000Z'),
      end_time: new Date('2026-09-10T03:00:00.000Z'),
      display_price_snapshot: 120,
    };
    const sendDirectMessage = jest.fn(async (userId: string) => {
      if (userId === 'provider-1') throw new Error('network outcome unknown');
    });
    const deliveryService = new OrderNotificationDeliveryService(
      dataSource.getRepository(OrderNotificationDelivery),
    );
    const subject = new OrderNotificationService(
      { findOne: jest.fn().mockResolvedValue(order) } as any,
      { findServiceInfoById: jest.fn() } as any,
      { findById: jest.fn() } as any,
      {
        findContactById: jest.fn(async (id: string) => ({
          id,
          username: id,
        })),
      } as any,
      { sendDirectMessage } as any,
      deliveryService,
    );
    const eventId = '2cc4fbed-37f4-4e85-bf4a-10e57224686f';

    await expect(
      subject.notifyNewOrder(order.id, eventId),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);
    await expect(
      subject.notifyNewOrder(order.id, eventId),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);

    expect(sendDirectMessage.mock.calls.map(([id]) => id)).toEqual([
      'consumer-1',
      'provider-1',
    ]);
    await expect(
      dataSource.getRepository(OrderNotificationDelivery).find({
        order: { recipient_id: 'ASC' },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipient_id: 'consumer:consumer-1',
          status: ORDER_NOTIFICATION_SENT,
        }),
        expect.objectContaining({
          recipient_id: 'provider:provider-1',
          status: ORDER_NOTIFICATION_UNCERTAIN,
        }),
      ]),
    );
  });
});
