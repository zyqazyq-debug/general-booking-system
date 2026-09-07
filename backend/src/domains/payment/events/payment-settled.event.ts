import type { PaymentChannel, PaymentPurpose } from '../payment.types';

export const PAYMENT_SETTLED_EVENT = 'payment.settled.v1';

export interface PaymentSettledEvent {
  eventVersion: 1;
  paymentEventId: string;
  transactionId: string;
  payerUserId: string;
  orderNo: string;
  tradeNo: string;
  channel: PaymentChannel | `${PaymentChannel}`;
  amountMinor: number;
  currency: 'CNY';
  purpose: PaymentPurpose | `${PaymentPurpose}`;
  occurredAt: string;
}
