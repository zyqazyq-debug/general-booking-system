import { z } from 'zod';
import { PaymentChannel } from '../payment.types';

export const ZPaymentChannelSchema = z.nativeEnum(PaymentChannel);

export const ZCreatePrepaySchema = z.object({
  channel: ZPaymentChannelSchema,
  order_no: z.string().max(64),
  amount: z.number().min(0.01),
  subject: z.string().max(128),
  return_url: z.string().max(255).optional(),
  notify_url: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreatePrepay = z.infer<typeof ZCreatePrepaySchema>;
