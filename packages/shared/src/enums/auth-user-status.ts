import { z } from 'zod';

/** Account lifecycle, not a login or identity-scan workflow status. */
export const ZAuthUserStatusEnum = z.enum(['ACTIVE', 'MERGED', 'DISABLED']);
export const AuthUserStatus = ZAuthUserStatusEnum.enum;
export type AuthUserStatus = z.infer<typeof ZAuthUserStatusEnum>;
