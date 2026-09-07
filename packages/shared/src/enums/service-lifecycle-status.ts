import { z } from 'zod';

/** Public lifecycle vocabulary; does not replace the existing boolean fields. */
export const ZServiceLifecycleStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'DELETED']);
export const ServiceLifecycleStatus = ZServiceLifecycleStatusEnum.enum;
export type ServiceLifecycleStatus = z.infer<typeof ZServiceLifecycleStatusEnum>;
