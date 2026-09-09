import { OrderNotificationAdapter } from './order-notification.adapter';

describe('OrderNotificationAdapter', () => {
  it('returns a definitive failure without invoking Telegram when no binding exists', async () => {
    const send = jest.fn();
    const subject = new OrderNotificationAdapter({ send } as never, {
      findContactById: jest.fn().mockResolvedValue(null),
    });

    await expect(
      subject.sendDirectMessage('user-1', 'private'),
    ).resolves.toEqual({
      outcome: 'failed',
      errorType: 'RecipientUnavailable',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates the structured provider receipt to the order port', async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: 'sent',
      providerMessageId: '421',
    });
    const subject = new OrderNotificationAdapter({ send } as never, {
      findContactById: jest
        .fn()
        .mockResolvedValue({ telegram_chat_id: 'private-chat' }),
    });

    await expect(
      subject.sendDirectMessage('user-1', 'private'),
    ).resolves.toEqual({ outcome: 'sent', providerMessageId: '421' });
  });
});
