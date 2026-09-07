import { PaymentChannel } from '../payment.types';
import { MockPaymentProvider } from './mock-payment.provider';

describe('MockPaymentProvider security boundary', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMockEnabled = process.env.PAYMENT_MOCK_ENABLED;
  const originalCallbackSecret = process.env.PAYMENT_MOCK_CALLBACK_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.PAYMENT_MOCK_ENABLED = originalMockEnabled;
    process.env.PAYMENT_MOCK_CALLBACK_SECRET = originalCallbackSecret;
  });

  it('rejects a forged callback without the test-only signature', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PAYMENT_MOCK_CALLBACK_SECRET = 'test-callback-secret';
    const provider = new MockPaymentProvider();

    const result = await provider.verifyNotification(
      PaymentChannel.WECHAT,
      {
        order_no: 'order-1',
        trade_no: 'trade-1',
        amount_minor: 100,
        currency: 'CNY',
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error_message).toContain('signature');
  });

  it('fails closed in production even when the mock enable flag is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.PAYMENT_MOCK_CALLBACK_SECRET = 'test-callback-secret';
    const provider = new MockPaymentProvider();

    await expect(
      provider.createPrepay({
        channel: PaymentChannel.WECHAT,
        order_no: 'order-1',
        amount: 1,
        subject: 'test',
      }),
    ).rejects.toThrow('disabled');

    await expect(
      provider.verifyNotification(
        PaymentChannel.WECHAT,
        {
          order_no: 'order-1',
          trade_no: 'trade-1',
          amount_minor: 100,
          currency: 'CNY',
        },
        { 'x-mock-payment-signature': 'test-callback-secret' },
      ),
    ).resolves.toMatchObject({ success: false });
  });
});
