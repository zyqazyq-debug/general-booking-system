/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { OrderNotificationService } from './order-notification.service';
import {
  ORDER_NOTIFICATION_FAILED,
  ORDER_NOTIFICATION_SENT,
  ORDER_NOTIFICATION_UNCERTAIN,
  OrderNotificationDelivery,
} from '../outbox/order-notification-delivery.entity';
import { OrderNotificationDeliveryService } from '../outbox/order-notification-delivery.service';
import { OrderOutboxEvent } from '../outbox/order-outbox-event.entity';
import { OrderOutboxService } from '../outbox/order-outbox.service';

describe('OrderNotificationService durable order-created delivery', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [OrderNotificationDelivery, OrderOutboxEvent],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const order = {
    id: '1b94f42e-0eb8-4a27-a505-da49266847f2',
    order_no: 'O1',
    service_id: 'dd5b1667-e598-49eb-801f-e09ab72941b0',
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

  function createSubject(
    sendDirectMessage: jest.Mock,
    deliveryService = new OrderNotificationDeliveryService(
      dataSource.getRepository(OrderNotificationDelivery),
    ),
  ) {
    return new OrderNotificationService(
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
  }

  it('finishes when one recipient is uncertain and does not resend either terminal recipient', async () => {
    const sendDirectMessage = jest.fn(async (userId: string) => {
      if (userId === 'provider-1') {
        return {
          outcome: 'uncertain' as const,
          errorType: 'TransportInterrupted',
        };
      }
      return { outcome: 'sent' as const, providerMessageId: '421' };
    });
    const subject = createSubject(sendDirectMessage);
    const eventId = '2cc4fbed-37f4-4e85-bf4a-10e57224686f';

    await expect(
      subject.notifyNewOrder(order.id, eventId),
    ).resolves.toBeUndefined();
    await expect(
      subject.notifyNewOrder(order.id, eventId),
    ).resolves.toBeUndefined();

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

  it('attempts the provider after an unbound consumer and marks both deliveries terminal', async () => {
    const sendDirectMessage = jest.fn(async (userId: string) =>
      userId === 'consumer-1'
        ? {
            outcome: 'failed' as const,
            errorType: 'RecipientUnavailable',
          }
        : { outcome: 'sent' as const, providerMessageId: '422' },
    );
    const subject = createSubject(sendDirectMessage);
    const eventId = '9e065fc8-39bd-42bd-90ea-99e4338b844f';

    await expect(
      subject.notifyNewOrder(order.id, eventId),
    ).resolves.toBeUndefined();
    const restartedSubject = createSubject(sendDirectMessage);
    await expect(
      restartedSubject.notifyNewOrder(order.id, eventId),
    ).resolves.toBeUndefined();

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
          status: ORDER_NOTIFICATION_FAILED,
          last_error_type: 'RecipientUnavailable',
        }),
        expect.objectContaining({
          recipient_id: 'provider:provider-1',
          status: ORDER_NOTIFICATION_SENT,
          provider_message_id: '422',
        }),
      ]),
    );
  });

  it('attempts the provider even when the consumer delivery has a retriable internal failure', async () => {
    const sendDirectMessage = jest.fn();
    const internalFailure = new Error('database unavailable');
    const sendOnce = jest.fn(async (_eventId: string, recipientId: string) => {
      if (recipientId === 'consumer:consumer-1') throw internalFailure;
    });
    const subject = createSubject(sendDirectMessage, {
      sendOnce,
    } as unknown as OrderNotificationDeliveryService);

    await expect(
      subject.notifyNewOrder(order.id, '6605bb95-c0fb-49b9-b731-25612ab956a9'),
    ).rejects.toBe(internalFailure);
    expect(sendOnce.mock.calls.map(([, recipientId]) => recipientId)).toEqual([
      'consumer:consumer-1',
      'provider:provider-1',
    ]);
  });

  it('processes the domain event after terminal delivery outcomes and a restart cannot resend it', async () => {
    const sendDirectMessage = jest.fn(async (userId: string) =>
      userId === 'consumer-1'
        ? { outcome: 'uncertain' as const, errorType: 'TransportInterrupted' }
        : { outcome: 'sent' as const, providerMessageId: '423' },
    );
    const notification = createSubject(sendDirectMessage);
    const eventRepository = dataSource.getRepository(OrderOutboxEvent);
    const emitter = {
      emitAsync: jest.fn(
        async (
          _eventType: string,
          payload: { orderId: string; eventId: string },
        ) => {
          await notification.notifyNewOrder(payload.orderId, payload.eventId);
          return [];
        },
      ),
    };
    const config = {
      get: jest.fn((key: string) =>
        ['BOOKING_WORKERS_ENABLED', 'ORDER_OUTBOX_DISPATCH_ENABLED'].includes(
          key,
        )
          ? 'true'
          : undefined,
      ),
    };
    const outbox = new OrderOutboxService(
      eventRepository,
      emitter as unknown as EventEmitter2,
      config as unknown as ConfigService,
    );
    const event = await dataSource.transaction((manager) =>
      outbox.enqueueOrderCreated(manager, {
        orderId: order.id,
        orderNo: order.order_no,
        serviceId: order.service_id,
        agencyNodeId: null,
        customerId: order.consumer_id,
        providerId: order.owner_id,
        priceSnapshot: { basePrice: 100, displayPrice: 120 },
      }),
    );

    await expect(outbox.dispatchById(event.id)).resolves.toBe(true);
    await expect(
      eventRepository.findOneByOrFail({ id: event.id }),
    ).resolves.toMatchObject({
      status: 'processed',
      attempts: 1,
      processed_at: expect.any(Date),
    });

    const restartedNotification = createSubject(sendDirectMessage);
    const restartedEmitter = {
      emitAsync: jest.fn(
        async (
          _eventType: string,
          payload: { orderId: string; eventId: string },
        ) => {
          await restartedNotification.notifyNewOrder(
            payload.orderId,
            payload.eventId,
          );
          return [];
        },
      ),
    };
    const restartedOutbox = new OrderOutboxService(
      eventRepository,
      restartedEmitter as unknown as EventEmitter2,
      config as unknown as ConfigService,
    );

    await expect(restartedOutbox.dispatchById(event.id)).resolves.toBe(false);
    await expect(
      restartedNotification.notifyNewOrder(order.id, event.id),
    ).resolves.toBeUndefined();
    expect(sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(restartedEmitter.emitAsync).not.toHaveBeenCalled();
    outbox.onModuleDestroy();
    restartedOutbox.onModuleDestroy();
  });
});
