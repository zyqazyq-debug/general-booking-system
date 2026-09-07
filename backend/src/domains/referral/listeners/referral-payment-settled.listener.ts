import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PAYMENT_SETTLED_EVENT,
  type PaymentSettledEvent,
} from '../../payment/events/payment-settled.event';
import { ReferralService } from '../referral.service';

@Injectable()
export class ReferralPaymentSettledListener {
  constructor(private readonly referralService: ReferralService) {}

  @OnEvent(PAYMENT_SETTLED_EVENT)
  handle(event: PaymentSettledEvent) {
    return this.referralService.handlePaymentSettled(event);
  }
}
