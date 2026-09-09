import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { OrderOutboxService } from './order-outbox.service';
import {
  ORDER_OUTBOX_PENDING,
  ORDER_OUTBOX_PROCESSED,
  ORDER_OUTBOX_PROCESSING,
  OrderOutboxEvent,
} from './order-outbox-event.entity';

describe('OrderOutboxService', () => {
  let dataSource: DataSource;
  let repository: Repository<OrderOutboxEvent>;
  let emitter: { emitAsync: jest.Mock };
  let subject: OrderOutboxService;

  const payload = {
    orderId: '1b94f42e-0eb8-4a27-a505-da49266847f2',
    orderNo: 'O1',
    serviceId: 'dd5b1667-e598-49eb-801f-e09ab72941b0',
    agencyNodeId: null,
    customerId: 'consumer-1',
    providerId: 'provider-1',
    priceSnapshot: { basePrice: 100, displayPrice: 120 },
  };

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [OrderOutboxEvent],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(OrderOutboxEvent);
    emitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    subject = new OrderOutboxService(
      repository,
      emitter as unknown as EventEmitter2,
      {
        get: jest.fn((key: string) =>
          ['BOOKING_WORKERS_ENABLED', 'ORDER_OUTBOX_DISPATCH_ENABLED'].includes(
            key,
          )
            ? 'true'
            : undefined,
        ),
      } as unknown as ConfigService,
    );
  });

  afterEach(async () => {
    subject.onModuleDestroy();
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  async function enqueue() {
    return dataSource.transaction((manager) =>
      subject.enqueueOrderCreated(manager, payload),
    );
  }

  it('stores the event in the caller transaction and rolls it back with that transaction', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await subject.enqueueOrderCreated(manager, payload);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await repository.count()).toBe(0);
  });

  it('requeues a failed delivery and later recovers the same stable event', async () => {
    const event = await enqueue();
    emitter.emitAsync.mockRejectedValueOnce(new Error('consumer failed'));

    await expect(subject.dispatchById(event.id)).rejects.toThrow(
      'consumer failed',
    );
    const failed = await repository.findOneByOrFail({ id: event.id });
    expect(failed).toMatchObject({
      status: ORDER_OUTBOX_PENDING,
      attempts: 1,
      claim_token: null,
    });
    expect(failed.last_error).toBe('Error');

    await repository.update(event.id, { available_at: new Date(0) });
    await expect(subject.dispatchById(event.id)).resolves.toBe(true);

    const recovered = await repository.findOneByOrFail({ id: event.id });
    expect(recovered).toMatchObject({
      status: ORDER_OUTBOX_PROCESSED,
      attempts: 2,
      processed_at: expect.any(Date),
    });
    expect(emitter.emitAsync).toHaveBeenLastCalledWith(
      'order.created',
      expect.objectContaining({ eventId: event.id, orderId: payload.orderId }),
    );
  });

  it('grants only one live dispatcher lease for concurrent attempts', async () => {
    const event = await enqueue();
    let releaseDelivery!: () => void;
    let deliveryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    emitter.emitAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve;
          deliveryStarted();
        }),
    );

    const first = subject.dispatchById(event.id);
    await started;
    await expect(subject.dispatchById(event.id)).resolves.toBe(false);
    releaseDelivery();
    await expect(first).resolves.toBe(true);

    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('reclaims an abandoned processing event after lease expiry', async () => {
    const event = await enqueue();
    await repository.update(event.id, {
      status: ORDER_OUTBOX_PROCESSING,
      claim_token: 'abandoned-owner',
      lease_expires_at: new Date(0),
    });

    await expect(subject.dispatchById(event.id)).resolves.toBe(true);
    await expect(
      repository.findOneByOrFail({ id: event.id }),
    ).resolves.toMatchObject({ status: ORDER_OUTBOX_PROCESSED });
  });

  it('exposes order-scoped outbox state for replay recovery and diagnostics', async () => {
    const event = await enqueue();

    await expect(
      subject.getOrderCreatedOutbox(payload.orderId),
    ).resolves.toMatchObject({ id: event.id, status: ORDER_OUTBOX_PENDING });
  });

  it('does not claim events when worker or dispatcher fencing is disabled', async () => {
    const event = await enqueue();
    const disabled = new OrderOutboxService(
      repository,
      emitter as unknown as EventEmitter2,
      { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService,
    );

    disabled.onModuleInit();
    await expect(disabled.dispatchById(event.id)).resolves.toBe(false);
    await expect(
      repository.findOneByOrFail({ id: event.id }),
    ).resolves.toMatchObject({ status: ORDER_OUTBOX_PENDING, attempts: 0 });
    expect(emitter.emitAsync).not.toHaveBeenCalled();
    disabled.onModuleDestroy();
  });
});
