import { z } from 'zod';

export const ZRegisterSchema = z.object({
  username: z.string(),
  password: z.string(),
  locale: z.string().optional(),
  referral_code: z.string().optional(),
  email: z.string().email().optional(),
}).strict();

export type Register = z.infer<typeof ZRegisterSchema>;
