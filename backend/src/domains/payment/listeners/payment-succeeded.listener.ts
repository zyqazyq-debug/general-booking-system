import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PaymentUsersPort } from '../ports/payment-users.port';
import { PAYMENT_USERS_PORT } from '../ports/tokens';

@Injectable()
export class PaymentSucceededListener {
  private readonly logger = new Logger(PaymentSucceededListener.name);

  constructor(
    @Inject(PAYMENT_USERS_PORT)
    private readonly usersPort: PaymentUsersPort,
  ) {}

  @OnEvent('payment.succeeded')
  async handlePaymentSucceeded(payload: {
    userId: string;
    amount: number;
    orderNo: string;
    tradeNo: string;
  }) {
    this.logger.log(
      `Payment succeeded for user ${payload.userId}, amount ${payload.amount}. Updating balance.`,
    );

    try {
      // Add credit to user balance
      // Note: In a real system, you might have a conversion rate between money and credits.
      // For now, we assume 1:1 or handle it as credits directly.
      await this.usersPort.addCredit(payload.userId, payload.amount);

      this.logger.log(
        `Successfully added ${payload.amount} credits to user ${payload.userId} for order ${payload.orderNo}`,
      );
    } catch (error: unknown) {
      const resolvedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to add credit for user ${payload.userId} after successful payment: ${resolvedError.message}`,
        resolvedError.stack,
      );
      // In production, this should trigger an alert or a manual reconciliation task.
    }
  }
}
