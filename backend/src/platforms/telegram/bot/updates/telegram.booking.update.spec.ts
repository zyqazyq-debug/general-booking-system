import { Context } from 'telegraf';
import { buildTelegramBookingIdempotencyKey } from './telegram.booking.update';

describe('Telegram booking update identity', () => {
  it('uses bot identity and update_id without embedding a bot token', () => {
    const ctx = {
      botInfo: { id: 42 },
      update: { update_id: 1001 },
    } as unknown as Context;

    const key = buildTelegramBookingIdempotencyKey(ctx);

    expect(key).toBe('telegram:42:update:1001:create_booking');
    expect(key).not.toMatch(/bot\d+:/i);
  });

  it('fails closed when the update identity is unavailable', () => {
    expect(() => buildTelegramBookingIdempotencyKey({} as Context)).toThrow(
      'Telegram booking update identity is unavailable',
    );
  });
});
