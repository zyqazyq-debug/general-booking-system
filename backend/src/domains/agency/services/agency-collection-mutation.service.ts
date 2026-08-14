import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';
import { CollectionQuotaService } from '../quota/collection-quota.service';
import { AgencyTreeService } from './agency-tree.service';
import { AgencyPricingService } from './agency-pricing.service';
import { AgencyGraphService } from '../utils/agency-graph-service';

type ServicePriceCompat = {
  base_price: number;
  provider_base_price?: number;
  cost_price?: number;
  sale_price?: number;
};

@Injectable()
export class AgencyCollectionMutationService {
  private agencyGraphService: AgencyGraphService;

  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
    private readonly collectionQuotaService: CollectionQuotaService,
    private readonly agencyTreeService: AgencyTreeService,
    private readonly agencyPricingService: AgencyPricingService,
  ) {
    this.agencyGraphService = new AgencyGraphService(agencyRepository);
  }

  async removeCollection(agentId: string, nodeId: string) {
    const node = await this.agencyRepository.findOne({
      where: { id: nodeId, agent_id: agentId },
    });
    if (!node) throw new NotFoundException('Collection not found');

    node.status = 'DELETED';
    await this.agencyRepository.save(node);

    const children = await this.agencyRepository.find({
      where: { parent_node_id: nodeId },
    });
    for (const child of children) {
      if (child.status !== 'DELETED') {
        child.status = 'DELETED';
        await this.agencyRepository.save(child);
        await this.cascadeDeletion(child.id);
      }
    }

    return { success: true };
  }

  async setCollectionStatus(
    agentId: string,
    nodeId: string,
    isActive: boolean,
  ) {
    const node = await this.agencyRepository.findOne({
      where: { id: nodeId, agent_id: agentId },
    });
    if (!node) throw new NotFoundException('Collection not found');

    if (isActive) {
      if (node.status !== 'ACTIVE') {
        await this.collectionQuotaService.assertCanActivate(agentId, 1);
      }
      node.status = 'ACTIVE';
      return this.agencyRepository.save(node);
    }

    node.status = 'INACTIVE';
    await this.agencyRepository.save(node);
    await this.cascadeInactivation(node.id);
    return this.agencyRepository.findOne({
      where: { id: node.id },
      relations: ['service', 'service.owner'],
    });
  }

  async reparentCollection(
    agentId: string,
    nodeId: string,
    newParentNodeId: string,
  ) {
    const node = await this.agencyRepository.findOne({
      where: { id: nodeId, agent_id: agentId },
      relations: ['service'],
    });
    if (!node) throw new NotFoundException('Collection not found');

    const newParent = await this.agencyRepository.findOne({
      where: { id: newParentNodeId },
    });
    if (!newParent) throw new NotFoundException('New parent node not found');
    if (newParent.status !== 'ACTIVE') {
      throw new BadRequestException('New parent node is not active');
    }
    if (node.status !== 'ACTIVE') {
      throw new BadRequestException('Current collection is not active');
    }
    if (node.service_id !== newParent.service_id) {
      throw new BadRequestException(
        'Service mismatch: New parent must offer the same service',
      );
    }
    if (node.id === newParent.id) {
      throw new BadRequestException('Cannot set self as parent');
    }

    await this.agencyTreeService.assertNoReparentCircular(
      node.id,
      newParent.id,
    );

    node.parent_node_id = newParent.id;
    node.cache_cost_price = Number(newParent.cache_total_price);
    node.markup_amount = this.agencyPricingService.calculateMarkupAmount(
      node.cache_cost_price,
      node.markup_type,
      node.markup_value,
    );
    node.cache_total_price = this.agencyPricingService.calculateTotalPrice(
      node.cache_cost_price,
      node.markup_amount,
    );

    const savedNode = await this.agencyRepository.save(node);
    await this.agencyGraphService.propagatePriceUpdate(
      savedNode.id,
      savedNode.cache_total_price,
    );
    return this.findById(savedNode.id);
  }

  async updateCollection(
    actorId: string,
    nodeId: string,
    data: {
      markup_amount?: number;
      private_notes?: string;
      public_notes?: string;
      markup_type?: string;
      markup_value?: number;
      alias?: string;
    },
  ) {
    const node = await this.agencyRepository.findOne({
      where: { id: nodeId },
      relations: ['service'],
    });
    if (!node) throw new NotFoundException('Collection not found');

    if (
      node.agent_id !== actorId &&
      !(await this.isAncestorOfSafe(actorId, node.agent_id))
    ) {
      throw new ForbiddenException(
        `Ownership violation: actor ${actorId} cannot mutate markup of agency-node ${node.id} (agent_id=${node.agent_id}, not ancestor nor self)`
      );
    }

    const effectiveMarkupType = data.markup_type
      ? (() => {
          const normalizedType = data.markup_type.toUpperCase();
          return normalizedType === 'PERCENTAGE' ? 'PERCENT' : normalizedType;
        })()
      : node.markup_type;
    const effectiveMarkupValue =
      typeof data.markup_value === 'number' ? data.markup_value : node.markup_value;

    if (effectiveMarkupType === 'PERCENT') {
      if (effectiveMarkupValue < 0 || effectiveMarkupValue > 100) {
        throw new BadRequestException(
          `InvalidMarkupValueError: PERCENT markup_value must be in [0, 100], got ${effectiveMarkupValue}`
        );
      }
    } else if (effectiveMarkupType === 'FIXED') {
      if (effectiveMarkupValue < 0) {
        throw new BadRequestException(
          `InvalidMarkupValueError: FIXED markup_value must be >= 0, got ${effectiveMarkupValue}`
        );
      }
    }

    if (data.markup_type) {
      node.markup_type = effectiveMarkupType;
    }
    if (typeof data.markup_value === 'number')
      node.markup_value = data.markup_value;
    if (
      typeof data.markup_amount === 'number' &&
      !Number.isNaN(data.markup_amount)
    ) {
      node.markup_amount = data.markup_amount;
    }
    if (typeof data.private_notes === 'string') {
      node.private_notes = data.private_notes;
    }
    if (typeof data.public_notes === 'string') {
      node.public_notes = data.public_notes;
    }
    if (typeof data.alias === 'string') {
      node.alias = data.alias;
    }

    if (data.markup_type || data.markup_value !== undefined) {
      node.markup_amount = this.agencyPricingService.calculateMarkupAmount(
        node.cache_cost_price,
        node.markup_type,
        node.markup_value,
      );
      node.cache_total_price = this.agencyPricingService.calculateTotalPrice(
        node.cache_cost_price,
        node.markup_amount,
      );
    }

    const savedNode = await this.agencyRepository.save(node);
    await this.agencyGraphService.propagatePriceUpdate(
      savedNode.id,
      savedNode.cache_total_price,
    );

    const finalNode = await this.agencyRepository.findOne({
      where: { id: savedNode.id },
      relations: ['service', 'service.owner'],
    });
    if (finalNode && finalNode.service) {
      const servicePrice = finalNode.service as unknown as ServicePriceCompat;
      const providerBasePrice = Number(finalNode.service.base_price);
      finalNode.service.base_price = finalNode.cache_cost_price;
      servicePrice.provider_base_price = providerBasePrice;
      servicePrice.cost_price = Number(finalNode.cache_cost_price);
      servicePrice.sale_price = Number(finalNode.cache_total_price);
    }
    return finalNode;
  }

  private async findById(id: string) {
    const node = await this.agencyRepository.findOne({
      where: { id },
      relations: ['service'],
    });
    if (node && node.service) {
      const servicePrice = node.service as unknown as ServicePriceCompat;
      const providerBasePrice = Number(node.service.base_price);
      node.service.base_price = node.cache_cost_price;
      servicePrice.provider_base_price = providerBasePrice;
      servicePrice.cost_price = Number(node.cache_cost_price);
      servicePrice.sale_price = Number(node.cache_total_price);
    }
    return node;
  }

  private async cascadeDeletion(parentId: string) {
    const children = await this.agencyRepository.find({
      where: { parent_node_id: parentId },
    });
    for (const child of children) {
      if (child.status !== 'DELETED') {
        child.status = 'DELETED';
        await this.agencyRepository.save(child);
        await this.cascadeDeletion(child.id);
      }
    }
  }

  private async cascadeInactivation(parentId: string) {
    const children = await this.agencyRepository.find({
      where: { parent_node_id: parentId },
    });
    for (const child of children) {
      if (child.status !== 'INACTIVE' && child.status !== 'DELETED') {
        child.status = 'INACTIVE';
        await this.agencyRepository.save(child);
      }
      await this.cascadeInactivation(child.id);
    }
  }

  private async isAncestorOfSafe(
    _ancestorAgentId: string,
    _descendantAgentId: string
  ): Promise<boolean> {
    return false;
  }
}
