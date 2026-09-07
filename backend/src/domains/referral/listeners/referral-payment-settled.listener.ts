import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  REFERRAL_PAYMENT_SETTLED_EVENT,
  type VerifiedPaymentEvent,
} from '../contracts/verified-payment-event';
import { ReferralService } from '../referral.service';

@Injectable()
export class ReferralPaymentSettledListener {
  constructor(private readonly referralService: ReferralService) {}

  @OnEvent(REFERRAL_PAYMENT_SETTLED_EVENT)
  handle(event: VerifiedPaymentEvent) {
    return this.referralService.handlePaymentSettled(event);
  }
}
