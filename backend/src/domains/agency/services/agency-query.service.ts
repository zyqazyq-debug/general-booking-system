import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';

@Injectable()
export class AgencyQueryService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {}

  private extractLegacyPublicNotes(privateNotes?: string | null) {
    if (!privateNotes) return '';
    const parts = String(privateNotes).split('\n');
    for (const part of parts) {
      if (part.startsWith('说明：')) {
        return part.replace('说明：', '');
      }
    }
    return '';
  }

  async getMyCollection(agentId: string): Promise<AgencyNode[]> {
    const nodes = await this.agencyRepository
      .createQueryBuilder('node')
      .leftJoin('node.service', 'service')
      .leftJoin('service.owner', 'owner')
      .leftJoin('node.parent_node', 'parentNode')
      .select([
        'node.id',
        'node.status',
        'node.cache_cost_price',
        'node.cache_total_price',
        'node.alias',
        'node.inherited_name',
        'node.created_at',
        'node.agent_id',
        'node.service_id',
        'node.parent_node_id',
        'node.markup_type',
        'node.markup_value',
        'node.private_notes',
        'node.public_notes',
        'node.share_slug',
      ])
      .addSelect([
        'service.id',
        'service.title',
        'service.base_price',
        'service.is_active',
        'service.duration_minutes',
        'service.deposit_points',
        'service.original_notes',
        'service.description',
        'service.rules',
      ])
      .addSelect(['owner.id', 'owner.nickname', 'owner.avatar'])
      .addSelect([
        'parentNode.id',
        'parentNode.alias',
        'parentNode.inherited_name',
        'parentNode.status',
      ])
      .where('node.agent_id = :agentId', { agentId })
      .andWhere('node.status != :deletedStatus', { deletedStatus: 'DELETED' })
      .orderBy("CASE WHEN node.status = 'ACTIVE' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('service.is_active', 'DESC')
      .addOrderBy('node.created_at', 'DESC')
      .getMany();

    for (const node of nodes) {
      if (node.service) {
        const providerBasePrice = Number(node.service.base_price);
        node.service.base_price = node.cache_cost_price;
        node.service.provider_base_price = providerBasePrice;
        node.service.cost_price = Number(node.cache_cost_price);
        node.service.sale_price = Number(node.cache_total_price);
      }
    }
    return nodes;
  }

  async findAll(): Promise<AgencyNode[]> {
    const nodes = await this.agencyRepository.find({
      relations: ['agent', 'service', 'service.owner'],
      order: { created_at: 'DESC' },
    });
    for (const node of nodes) {
      if (node.service) {
        const providerBasePrice = Number(node.service.base_price);
        node.service.base_price = node.cache_cost_price;
        node.service.provider_base_price = providerBasePrice;
        node.service.cost_price = Number(node.cache_cost_price);
        node.service.sale_price = Number(node.cache_total_price);
      }
    }
    return nodes;
  }

  async findById(id: string) {
    const node = await this.agencyRepository.findOne({
      where: { id },
      relations: ['service'],
    });
    if (node && node.service) {
      const providerBasePrice = Number(node.service.base_price);
      node.service.base_price = node.cache_cost_price;
      node.service.provider_base_price = providerBasePrice;
      node.service.cost_price = Number(node.cache_cost_price);
      node.service.sale_price = Number(node.cache_total_price);
    }
    return node;
  }

  async findByAgentAndService(
    agentId: string,
    serviceId: string,
    includeInactive = false,
  ) {
    const where: FindOptionsWhere<AgencyNode> = {
      agent_id: agentId,
      service_id: serviceId,
    };
    if (!includeInactive) {
      where.status = 'ACTIVE';
    }
    return this.agencyRepository.findOne({ where });
  }

  async findOne(id: string) {
    return this.agencyRepository.findOne({
      where: { id },
      relations: ['service', 'service.owner', 'agent'],
    });
  }

  async findBySlug(slug: string) {
    const nodeAny = await this.agencyRepository.findOne({
      where: { share_slug: slug },
      relations: ['service', 'service.owner', 'agent'],
    });
    if (!nodeAny) {
      throw new NotFoundException('Agency node not found');
    }

    const isNodeActive = nodeAny.status === 'ACTIVE';
    const isServiceActive = nodeAny.service && nodeAny.service.is_active;
    const finalPrice = nodeAny.cache_total_price;
    const importCost = finalPrice;

    const finalDescription =
      nodeAny.public_notes ||
      this.extractLegacyPublicNotes(nodeAny.private_notes) ||
      '';

    return {
      id: nodeAny.id,
      share_slug: nodeAny.share_slug,
      importInfo: {
        costPrice: importCost,
        markupType: nodeAny.markup_type,
        markupValue: nodeAny.markup_value,
        parentNodeId: nodeAny.id,
        serviceId: nodeAny.service_id,
      },
      service: {
        id: nodeAny.service.id,
        title: nodeAny.alias || nodeAny.inherited_name || nodeAny.service.title,
        duration_minutes: nodeAny.service.duration_minutes,
        deposit_points: nodeAny.service.deposit_points,
        buffer_minutes: nodeAny.service.buffer_minutes,
        rules: nodeAny.service.rules,
        base_price: Number(finalPrice.toFixed(2)),
        provider_base_price: Number(nodeAny.service.base_price),
        cost_price: Number(nodeAny.cache_cost_price),
        sale_price: Number(finalPrice.toFixed(2)),
        description: finalDescription,
        is_active: isServiceActive,
      },
      node_status: nodeAny.status,
      agent: {
        id: nodeAny.agent_id,
        nickname: nodeAny.agent.nickname,
        avatar: nodeAny.agent.avatar,
      },
      is_unavailable: !isNodeActive || !isServiceActive,
    };
  }
}
