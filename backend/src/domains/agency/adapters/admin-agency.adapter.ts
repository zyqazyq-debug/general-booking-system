import { Injectable } from '@nestjs/common';
import { AgencyService } from '../agency.service';
import type { AdminAgencyNodeDto, AdminAgencyPort } from '../../admin';

@Injectable()
export class AdminAgencyAdapter implements AdminAgencyPort {
  constructor(private readonly agencyService: AgencyService) {}

  async findAll(): Promise<AdminAgencyNodeDto[]> {
    const nodes = await this.agencyService.findAll();
    return nodes.map((node) => ({
      id: node.id,
      node_type: node.node_type,
      parent_node_id: node.parent_node_id,
      service_id: node.service_id,
      agent_id: node.agent_id,
      markup_amount: Number(node.markup_amount),
      cache_cost_price: Number(node.cache_cost_price),
      cache_total_price: Number(node.cache_total_price),
      markup_type: node.markup_type,
      markup_value: Number(node.markup_value),
      alias: node.alias ?? null,
      inherited_name: node.inherited_name ?? null,
      share_slug: node.share_slug,
      status: node.status,
      created_at: node.created_at,
      updated_at: node.updated_at,
      agent: node.agent
        ? { id: node.agent.id, nickname: node.agent.nickname ?? null }
        : null,
      service: node.service
        ? {
            id: node.service.id,
            title: node.service.title,
            is_active: node.service.is_active,
          }
        : null,
    }));
  }
}
