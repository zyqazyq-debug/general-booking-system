import { z } from 'zod';

/** Current writer vocabulary. Legacy values require an explicit migration. */
export const ZAgencyNodeStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'DELETED']);
export const AgencyNodeStatus = ZAgencyNodeStatusEnum.enum;
export type AgencyNodeStatus = z.infer<typeof ZAgencyNodeStatusEnum>;
