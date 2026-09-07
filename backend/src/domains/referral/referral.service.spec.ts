import type { Repository } from 'typeorm';
import type { VerifiedPaymentEvent } from './contracts/verified-payment-event';
import type { ReferralLog } from './entities/referral-log.entity';
import type {
  ReferralRewardPostingCommand,
  ReferralRewardPostingPort,
} from './ports/referral-reward-posting.port';
import { ReferralService } from './referral.service';

describe('ReferralService payment event boundary', () => {
  it('passes a stable paymentEventId to an idempotent posting port', async () => {
    const postedEventIds = new Set<string>();
    const appliedCommands: ReferralRewardPostingCommand[] = [];
    const postingPort: ReferralRewardPostingPort = {
      async postRewards(command) {
        if (postedEventIds.has(command.paymentEventId)) {
          return { duplicate: true, postings: [] };
        }
        postedEventIds.add(command.paymentEventId);
        appliedCommands.push(command);
        return { duplicate: false, postings: [] };
      },
    };
    const logsRepository = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ReferralLog>;
    const service = new ReferralService(logsRepository, postingPort);
    const event: VerifiedPaymentEvent = {
      eventVersion: 1,
      paymentEventId: 'payment-event-1',
      transactionId: 'transaction-1',
      payerUserId: 'payer-1',
      orderNo: 'order-1',
      tradeNo: 'trade-1',
      channel: 'wechat',
      amountMinor: 1000,
      currency: 'CNY',
      purpose: 'SOFTWARE_FEE',
      occurredAt: '2026-09-07T00:00:00.000Z',
    };

    await service.handlePaymentSettled(event);
    await service.handlePaymentSettled(event);

    expect(appliedCommands).toHaveLength(1);
    expect(appliedCommands[0]).toMatchObject({
      paymentEventId: 'payment-event-1',
      payerUserId: 'payer-1',
      amountMinor: 1000,
      currency: 'CNY',
    });
  });
});
