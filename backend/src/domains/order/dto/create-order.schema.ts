import { z } from 'zod';

export const ZCreateOrderSchema = z
  .object({
    service_id: z.string(),
    agency_node_id: z.string().optional(),
    start_time: z.string().datetime(),
    end_time: z.string().datetime(),
  })
  .strict();

export type CreateOrder = z.infer<typeof ZCreateOrderSchema>;
