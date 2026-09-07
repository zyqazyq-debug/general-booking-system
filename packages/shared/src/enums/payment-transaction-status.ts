import { z } from 'zod';

/** Preserve the existing payment HTTP/persistence wire values. */
export const ZPaymentTransactionStatusEnum = z.enum([
  'pending',
  'success',
  'failed',
  'cancelled',
]);
export const PaymentTransactionStatus = ZPaymentTransactionStatusEnum.enum;
export type PaymentTransactionStatus = z.infer<typeof ZPaymentTransactionStatusEnum>;
