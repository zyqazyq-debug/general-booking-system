import type { LoginResponse } from '../../auth';

export interface AgencyAuthPort {
  lightRegister(deviceInfo: Record<string, unknown>): Promise<LoginResponse>;
}
