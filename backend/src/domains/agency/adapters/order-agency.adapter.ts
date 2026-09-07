import { Injectable } from '@nestjs/common';
import type { OrderAgencyPort } from '../../order';
import type { AgencyNodeInfoDto } from '../dto/agency-node-info.dto';
import { AgencyQueryService } from '../services/agency-query.service';
import { AgencyTreeService } from '../services/agency-tree.service';

@Injectable()
export class OrderAgencyAdapter implements OrderAgencyPort {
  constructor(
    private readonly agencyQueryService: AgencyQueryService,
    private readonly agencyTreeService: AgencyTreeService,
  ) {}

  async findById(id: string): Promise<AgencyNodeInfoDto | null> {
    const node = await this.agencyQueryService.findInternalSnapshotById(id);
    if (!node) return null;
    return {
      id: node.id,
      service_id: node.service_id,
      agent_id: node.agent_id,
      parent_node_id: node.parent_node_id,
      status: node.status,
      markup_type: node.markup_type,
      markup_value: node.markup_value,
      cache_total_price: node.cache_total_price,
      alias: node.alias,
      inherited_name: node.inherited_name,
    };
  }

  async validateActiveChain(nodeId: string): Promise<void> {
    await this.agencyTreeService.validateActiveChain(nodeId);
  }

  async findByAgentAndService(
    agentId: string,
    serviceId: string,
    includeInactive?: boolean,
  ): Promise<AgencyNodeInfoDto | null> {
    const node = await this.agencyQueryService.findByAgentAndService(
      agentId,
      serviceId,
      includeInactive ?? false,
    );
    if (!node) return null;
    return {
      id: node.id,
      service_id: node.service_id,
      agent_id: node.agent_id,
      parent_node_id: node.parent_node_id,
      status: node.status,
      markup_type: node.markup_type,
      markup_value: node.markup_value,
      cache_total_price: node.cache_total_price,
      alias: node.alias,
      inherited_name: node.inherited_name,
    };
  }
}
