import { z } from 'zod';
import { ServiceBlockType } from '../entities/service-block.entity';

export const ZServiceBlockTypeSchema = z.nativeEnum(ServiceBlockType);

export const ZCreateServiceBlockSchema = z.object({
  type: ZServiceBlockTypeSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  reason: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateServiceBlock = z.infer<typeof ZCreateServiceBlockSchema>;
