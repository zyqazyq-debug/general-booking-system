import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { ReferralTestController } from './referral-test.controller';
import type { ReferralService } from './referral.service';

describe('ReferralController test-only simulator', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('rejects a cross-user simulated payment', async () => {
    process.env.NODE_ENV = 'test';
    const referralService = {
      handlePaymentSettled: jest.fn(),
    } as unknown as ReferralService;
    const controller = new ReferralTestController(referralService);
    const request = {
      user: { id: 'current-user' },
    } as AuthenticatedRequest;

    await expect(
      controller.simulatePayment(
        {
          paymentEventId: 'payment-event-1',
          userId: 'another-user',
          amountMinor: 100,
          currency: 'CNY',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(referralService.handlePaymentSettled).not.toHaveBeenCalled();
  });

  it('does not expose the simulator outside the test environment', async () => {
    process.env.NODE_ENV = 'production';
    const referralService = {
      handlePaymentSettled: jest.fn(),
    } as unknown as ReferralService;
    const controller = new ReferralTestController(referralService);
    const request = {
      user: { id: 'current-user' },
    } as AuthenticatedRequest;

    await expect(
      controller.simulatePayment(
        {
          paymentEventId: 'payment-event-1',
          userId: 'current-user',
          amountMinor: 100,
          currency: 'CNY',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(referralService.handlePaymentSettled).not.toHaveBeenCalled();
  });
});
