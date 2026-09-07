import { z } from 'zod';

export const ZServiceRulesSchema = z.object({
  start_hour: z.number(),
  end_hour: z.number(),
  weekdays: z.array(z.number()).optional(),
}).passthrough();

export const ZCancellationPolicySchema = z.object({
  penalty_percent: z.number(),
  window_minutes: z.number(),
});

export const ZLocationSchema = z.object({
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export const ZCreateServiceSchema = z.object({
  resource_template_id: z.string().optional(),
  title: z.string(),
  base_price: z.number(),
  deposit_points: z.number(),
  duration_minutes: z.number().optional(),
  buffer_minutes: z.number().optional(),
  is_active: z.boolean().optional(),
  description: z.string().optional(),
  original_notes: z.string().optional(),
  rules: ZServiceRulesSchema.optional(),
  cancellation_policy: ZCancellationPolicySchema.optional(),
  location: ZLocationSchema.optional(),
  metadata: z.any().optional(),
}).strict();

export type CreateService = z.infer<typeof ZCreateServiceSchema>;
