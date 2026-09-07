/**
 * Referral's local view of the public payment-settlement integration contract.
 * The event is deliberately structural: referral must not depend on payment
 * domain implementation files to consume an already-verified settlement.
 */
export const REFERRAL_PAYMENT_SETTLED_EVENT = 'payment.settled.v1';

export const ReferralPaymentPurpose = {
  CREDIT_PURCHASE: 'CREDIT_PURCHASE',
  SOFTWARE_FEE: 'SOFTWARE_FEE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ReferralPaymentPurpose =
  (typeof ReferralPaymentPurpose)[keyof typeof ReferralPaymentPurpose];

export interface VerifiedPaymentEvent {
  eventVersion: 1;
  paymentEventId: string;
  transactionId: string;
  payerUserId: string;
  orderNo: string;
  tradeNo: string;
  channel: 'wechat' | 'alipay';
  amountMinor: number;
  currency: 'CNY';
  purpose: ReferralPaymentPurpose;
  occurredAt: string;
}
