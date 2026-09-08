import { z } from 'zod';

export const ZLoginSchema = z.object({
  username: z.string(),
  password: z.string(),
  deviceInfo: z.record(z.unknown()).optional(),
});

export type Login = z.infer<typeof ZLoginSchema>;
