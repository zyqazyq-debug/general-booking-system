import { DataSource, Repository } from 'typeorm';
import {
  ORDER_NOTIFICATION_FAILED,
  ORDER_NOTIFICATION_SENDING,
  ORDER_NOTIFICATION_SENT,
  ORDER_NOTIFICATION_UNCERTAIN,
  OrderNotificationDelivery,
} from './order-notification-delivery.entity';
import {
  OrderNotificationDeliveryService,
  OrderNotificationDeliveryFailedError,
  OrderNotificationDeliveryUncertainError,
} from './order-notification-delivery.service';

describe('OrderNotificationDeliveryService', () => {
  let dataSource: DataSource;
  let repository: Repository<OrderNotificationDelivery>;
  let subject: OrderNotificationDeliveryService;
  const eventId = '2cc4fbed-37f4-4e85-bf4a-10e57224686f';
  const recipient = 'consumer:user-1';

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [OrderNotificationDelivery],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(OrderNotificationDelivery);
    subject = new OrderNotificationDeliveryService(repository);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('sends once and suppresses a committed replay', async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: 'sent',
      providerMessageId: '421',
    });

    await subject.sendOnce(eventId, recipient, send);
    await subject.sendOnce(eventId, recipient, send);

    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      repository.findOneByOrFail({
        event_id: eventId,
        recipient_id: recipient,
      }),
    ).resolves.toMatchObject({
      status: ORDER_NOTIFICATION_SENT,
      provider_message_id: '421',
    });
  });

  it('does not issue a second external send while another claim is live', async () => {
    let release!: (result: {
      outcome: 'sent';
      providerMessageId: string;
    }) => void;
    let started!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = jest.fn(
      () =>
        new Promise<{ outcome: 'sent'; providerMessageId: string }>(
          (resolve) => {
            release = resolve;
            started();
          },
        ),
    );

    const first = subject.sendOnce(eventId, recipient, send);
    await sendStarted;
    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);
    release({ outcome: 'sent', providerMessageId: '422' });
    await first;

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records a definitive failure separately and never retries it automatically', async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: 'failed',
      errorType: 'TelegramApi403',
    });

    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryFailedError);
    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryFailedError);

    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      repository.findOneByOrFail({
        event_id: eventId,
        recipient_id: recipient,
      }),
    ).resolves.toMatchObject({
      status: ORDER_NOTIFICATION_FAILED,
      provider_message_id: null,
      last_error_type: 'TelegramApi403',
    });
  });

  it('marks a thrown external send as uncertain and never retries it automatically', async () => {
    const send = jest.fn().mockRejectedValue(new Error('host and SQL details'));

    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);
    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);

    expect(send).toHaveBeenCalledTimes(1);
    const delivery = await repository.findOneByOrFail({
      event_id: eventId,
      recipient_id: recipient,
    });
    expect(delivery).toMatchObject({
      status: ORDER_NOTIFICATION_UNCERTAIN,
      last_error_type: 'Error',
    });
    expect(JSON.stringify(delivery)).not.toContain('host and SQL details');
  });

  it('turns a crash-abandoned sending lease into uncertain without sending again', async () => {
    await repository.insert({
      id: 'b70e37dc-4c92-418b-aafa-c614a2ac0d6d',
      event_id: eventId,
      recipient_id: recipient,
      status: ORDER_NOTIFICATION_SENDING,
      claim_token: 'crashed-owner',
      lease_expires_at: new Date(0),
      sent_at: null,
      provider_message_id: null,
      last_error_type: null,
    });
    const send = jest.fn();

    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);

    expect(send).not.toHaveBeenCalled();
    await expect(
      repository.findOneByOrFail({
        event_id: eventId,
        recipient_id: recipient,
      }),
    ).resolves.toMatchObject({
      status: ORDER_NOTIFICATION_UNCERTAIN,
      last_error_type: 'SendingLeaseExpired',
    });
  });

  it('does not mark sent when a provider success receipt is absent', async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: 'sent',
      providerMessageId: '',
    });

    await expect(
      subject.sendOnce(eventId, recipient, send),
    ).rejects.toBeInstanceOf(OrderNotificationDeliveryUncertainError);
    await expect(
      repository.findOneByOrFail({
        event_id: eventId,
        recipient_id: recipient,
      }),
    ).resolves.toMatchObject({
      status: ORDER_NOTIFICATION_UNCERTAIN,
      provider_message_id: null,
      last_error_type: 'InvalidProviderReceipt',
    });
  });
});
