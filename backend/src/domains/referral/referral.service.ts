import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaymentSettledEvent } from '../payment/events/payment-settled.event';
import { PaymentPurpose } from '../payment/payment.types';
import { ReferralLog } from './entities/referral-log.entity';
import {
  REFERRAL_REWARD_POSTING_PORT,
  type ReferralRewardPostingPort,
} from './ports/referral-reward-posting.port';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(ReferralLog)
    private readonly referralLogRepository: Repository<ReferralLog>,
    @Optional()
    @Inject(REFERRAL_REWARD_POSTING_PORT)
    private readonly rewardPostingPort?: ReferralRewardPostingPort,
  ) {}

  async handlePaymentSettled(event: PaymentSettledEvent) {
    if (event.purpose !== PaymentPurpose.SOFTWARE_FEE) {
      return { ignored: true, reason: 'payment-purpose-not-eligible' };
    }

    if (
      event.eventVersion !== 1 ||
      !event.paymentEventId ||
      !event.payerUserId ||
      !Number.isSafeInteger(event.amountMinor) ||
      event.amountMinor <= 0 ||
      event.currency !== 'CNY'
    ) {
      throw new BadRequestException('Invalid verified payment event');
    }

    if (!this.rewardPostingPort) {
      throw new ServiceUnavailableException(
        'Idempotent referral reward posting port is not configured',
      );
    }

    this.logger.log(
      `Posting referral rewards for payment event ${event.paymentEventId}`,
    );
    return this.rewardPostingPort.postRewards({
      paymentEventId: event.paymentEventId,
      payerUserId: event.payerUserId,
      amountMinor: event.amountMinor,
      currency: event.currency,
      orderNo: event.orderNo,
      tradeNo: event.tradeNo,
    });
  }

  async getReferralLogs(userId: string) {
    return this.referralLogRepository.find({
      where: { beneficiaryId: userId },
      order: { created_at: 'DESC' },
      relations: ['sourceUser'],
    });
  }
}
