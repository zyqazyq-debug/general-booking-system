import { z } from 'zod';

export const ZPaginationSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(500).optional().default(10),
});

export const ZOrderFilterSchema = ZPaginationSchema.extend({
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
});

export type OrderFilter = z.infer<typeof ZOrderFilterSchema>;
