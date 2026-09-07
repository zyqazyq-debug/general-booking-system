import { z } from 'zod';

export const ZPaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(10),
});

export type Pagination = z.infer<typeof ZPaginationSchema>;
