import {
  Injectable,
  Logger,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PaymentUsersPort } from '../ports/payment-users.port';
import { PAYMENT_USERS_PORT } from '../ports/tokens';
import {
  PAYMENT_SETTLED_EVENT,
  type PaymentSettledEvent,
} from '../events/payment-settled.event';
import { PaymentPurpose } from '../payment.types';

@Injectable()
export class PaymentSucceededListener {
  private readonly logger = new Logger(PaymentSucceededListener.name);

  constructor(
    @Inject(PAYMENT_USERS_PORT)
    private readonly usersPort: PaymentUsersPort,
  ) {}

  @OnEvent(PAYMENT_SETTLED_EVENT)
  async handlePaymentSucceeded(payload: PaymentSettledEvent) {
    if (payload.purpose !== PaymentPurpose.CREDIT_PURCHASE) {
      return;
    }

    this.logger.log(
      `Posting payment ${payload.paymentEventId} for user ${payload.payerUserId}.`,
    );

    if (!this.usersPort.postPaymentCredit) {
      throw new ServiceUnavailableException(
        'Idempotent users payment posting port is not configured',
      );
    }

    await this.usersPort.postPaymentCredit({
      paymentEventId: payload.paymentEventId,
      userId: payload.payerUserId,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      orderNo: payload.orderNo,
      tradeNo: payload.tradeNo,
    });
  }
}
