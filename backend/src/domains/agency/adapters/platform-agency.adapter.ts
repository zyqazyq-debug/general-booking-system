import { Injectable } from '@nestjs/common';

import { AgencyService } from '../agency.service';
import { AgencyQueryService } from '../services/agency-query.service';
import type { AgencyNode } from '../entities/agency-node.entity';

export type PlatformAgencyNodeDto = {
  id: string;
  service_id: string | null;
  agent_id: string | null;
  share_slug: string | null;
  status: string;
  alias: string | null;
  inherited_name: string | null;
  cache_total_price: number;
  cache_cost_price: number;
  markup_amount: number;
  markup_type: string;
  markup_value: number;
  service: {
    title: string;
    duration_minutes: number;
    is_active: boolean;
    is_deleted: boolean;
  } | null;
};

@Injectable()
export class PlatformAgencyAdapter {
  constructor(
    private readonly agencyService: AgencyService,
    private readonly agencyQueryService: AgencyQueryService,
  ) {}

  private mapNode(node: AgencyNode): PlatformAgencyNodeDto {
    return {
      id: node.id,
      service_id: node.service_id,
      agent_id: node.agent_id,
      share_slug: node.share_slug,
      status: node.status,
      alias: node.alias,
      inherited_name: node.inherited_name,
      cache_total_price: node.cache_total_price,
      cache_cost_price: node.cache_cost_price,
      markup_amount: node.markup_amount,
      markup_type: node.markup_type,
      markup_value: node.markup_value,
      service: node.service
        ? {
            title: node.service.title,
            duration_minutes: node.service.duration_minutes,
            is_active: node.service.is_active,
            is_deleted: node.service.is_deleted,
          }
        : null,
    };
  }

  async preCheckImport(agentId: string, code: string) {
    return this.agencyService.preCheckImport(agentId, code);
  }

  async importCollection(
    agentId: string,
    code: string,
    options?: {
      markup_type?: string;
      markup_value?: number;
      alias?: string;
      private_notes?: string;
      public_notes?: string;
      force_recreate_on_existing?: boolean;
      import_as_child?: boolean;
    },
  ): Promise<{ node: PlatformAgencyNodeDto; isNew: boolean }> {
    const result = await this.agencyService.importCollection(
      agentId,
      code,
      options,
    );
    return { node: this.mapNode(result.node), isNew: result.isNew };
  }

  async findById(id: string): Promise<PlatformAgencyNodeDto | null> {
    const node = await this.agencyQueryService.findInternalSnapshotById(id);
    if (!node) return null;
    return this.mapNode(node);
  }

  async findOne(id: string): Promise<PlatformAgencyNodeDto | null> {
    const node = await this.agencyQueryService.findInternalSnapshotById(id);
    if (!node) return null;
    return this.mapNode(node);
  }

  async findBySlug(slug: string): Promise<{ id: string } | null> {
    try {
      const result = await this.agencyService.findBySlug(slug);
      if (!result) return null;
      return { id: result.id };
    } catch {
      return null;
    }
  }

  async updateCollection(
    agentId: string,
    nodeId: string,
    data: {
      markup_amount?: number;
      private_notes?: string;
      public_notes?: string;
      markup_type?: string;
      markup_value?: number;
      alias?: string;
    },
  ): Promise<PlatformAgencyNodeDto | null> {
    const updated = await this.agencyService.updateCollection(
      agentId,
      nodeId,
      data,
    );
    if (!updated) return null;
    return this.mapNode(updated);
  }
}
