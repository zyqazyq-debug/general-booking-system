import { z } from 'zod';

const DIGITS_REGEX = /^\d+$/;

export const ZCreateAgencyNodeSchema = z.object({
  serviceId: z.string().optional(),
  listingId: z.string().regex(DIGITS_REGEX).optional(),
  listingIds: z.array(z.string().regex(DIGITS_REGEX)).optional(),
  parentNodeId: z.string().optional(),
  markup_amount: z.number().min(0).optional(),
  markup_type: z.string().optional(),
  markup_value: z.number().min(0).optional(),
  alias: z.string().max(200).optional(),
  private_notes: z.string().max(2000).optional(),
  public_notes: z.string().max(2000).optional(),
  compliance_content: z.string().max(20000).optional(),
  compliance_signature: z.string().max(4096).optional(),
  deviceInfo: z.record(z.unknown()).optional(),
});

export type CreateAgencyNode = z.infer<typeof ZCreateAgencyNodeSchema>;
