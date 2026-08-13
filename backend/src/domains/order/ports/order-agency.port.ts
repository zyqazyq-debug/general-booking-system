import type { AgencyNodeInfoDto } from '../../agency';

export interface OrderAgencyPort {
  findById(id: string): Promise<AgencyNodeInfoDto | null>;
  validateActiveChain(nodeId: string): Promise<void>;
  findByAgentAndService(
    agentId: string,
    serviceId: string,
    includeInactive?: boolean,
  ): Promise<AgencyNodeInfoDto | null>;
}
