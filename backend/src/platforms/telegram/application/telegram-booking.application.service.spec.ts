import { TelegramBookingApplicationService } from './telegram-booking.application.service';

describe('TelegramBookingApplicationService', () => {
  it('forwards the trusted update identity to the order domain port', async () => {
    const order = {
      id: 'order-1',
      order_no: 'O1',
      display_price_snapshot: 12,
    };
    const servicesPort = { getAvailableSlots: jest.fn() };
    const orderPort = { create: jest.fn().mockResolvedValue(order) };
    const usersPort = {
      findByTelegram: jest.fn().mockResolvedValue({ id: 'consumer-1' }),
    };
    const agencyPort = {
      findById: jest.fn().mockResolvedValue({
        id: 'collection-1',
        service_id: 'service-1',
        service: { duration_minutes: 30 },
      }),
    };
    const subject = new TelegramBookingApplicationService(
      servicesPort,
      orderPort,
      usersPort,
      agencyPort,
    );

    await subject.createBookingByCollectionSlot({
      chatId: '100',
      collectionId: 'collection-1',
      dateStr: '2026-09-10',
      timeStr: '10:00',
      sourceIdempotencyKey: 'telegram:42:update:1001',
    });

    expect(orderPort.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source_idempotency_key: 'telegram:42:update:1001',
      }),
    );
  });
});
