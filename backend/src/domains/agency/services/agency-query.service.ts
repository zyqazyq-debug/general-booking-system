import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';
import type {
  AgencyNodeViewDto,
  PublicAgencyNodeViewDto,
} from '../dto/agency-node-view.dto';

@Injectable()
export class AgencyQueryService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {}

  private toView(
    node: AgencyNode,
    options: { includeShareSlug: boolean },
  ): AgencyNodeViewDto {
    const displayPrice = Number(node.cache_total_price);
    const service = node.service;
    const result: AgencyNodeViewDto = {
      id: node.id,
      status: node.status,
      alias: node.alias ?? null,
      inherited_name: node.inherited_name ?? null,
      parent_node_id: node.parent_node_id,
      service_id: node.service_id,
      created_at: node.created_at,
      updated_at: node.updated_at,
      service: {
        id: service.id,
        title: node.alias || node.inherited_name || service.title,
        duration_minutes: service.duration_minutes,
        deposit_points: service.deposit_points,
        buffer_minutes: service.buffer_minutes,
        rules: service.rules,
        base_price: Number(displayPrice.toFixed(2)),
        description: node.public_notes || '',
        is_active: service.is_active,
      },
      agent: {
        id: node.agent_id,
        nickname: node.agent?.nickname ?? null,
        avatar: node.agent?.avatar ?? null,
      },
      is_unavailable: node.status !== 'ACTIVE' || !service.is_active,
    };
    if (options.includeShareSlug) {
      result.share_slug = node.share_slug;
    }
    return result;
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

  async findByIdForActor(
    id: string,
    actorId: string,
  ): Promise<AgencyNodeViewDto> {
    const node = await this.agencyRepository.findOne({
      where: { id },
      relations: ['service', 'agent'],
    });
    if (!node) {
      throw new NotFoundException('Agency node not found');
    }
    if (node.agent_id !== actorId) {
      throw new ForbiddenException('Agency node is not owned by actor');
    }
    return this.toView(node, { includeShareSlug: true });
  }

  async findInternalSnapshotById(id: string) {
    return this.agencyRepository.findOne({
      where: { id },
      relations: ['service', 'service.owner', 'agent'],
    });
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

  async findBySlug(slug: string): Promise<PublicAgencyNodeViewDto> {
    const nodeAny = await this.agencyRepository.findOne({
      where: { share_slug: slug },
      relations: ['service', 'service.owner', 'agent'],
    });
    if (!nodeAny) {
      throw new NotFoundException('Agency node not found');
    }
    if (nodeAny.status !== 'ACTIVE' || !nodeAny.service?.is_active) {
      throw new NotFoundException('Agency node is unavailable');
    }

    const publicView = this.toView(nodeAny, { includeShareSlug: true });
    const {
      status: node_status,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...safeView
    } = publicView;
    void _createdAt;
    void _updatedAt;

    return {
      ...safeView,
      node_status,
      importInfo: {
        parentNodeId: nodeAny.id,
        serviceId: nodeAny.service_id,
      },
    };
  }
}
