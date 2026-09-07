import { z } from 'zod';

export const ZOrderStatusEnum = z.enum([
  'PENDING',
  'RESERVED',
  'COMPLETED',
  'CANCELLED',
  'FORFEITED',
  'DISPUTED',
]);

export type OrderStatus = z.infer<typeof ZOrderStatusEnum>;
export const OrderStatus = ZOrderStatusEnum.enum;
