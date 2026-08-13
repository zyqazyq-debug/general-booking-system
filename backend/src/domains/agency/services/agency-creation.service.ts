﻿﻿﻿﻿﻿import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository, DataSource, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import { AgencyNode } from '../entities/agency-node.entity';
import { User } from '../../users';
import { CollectionQuotaService } from '../quota/collection-quota.service';
import { AgencyImportService } from './agency-import.service';
import { AgencyValidationService } from './agency-validation.service';
import { AgencyPricingService } from './agency-pricing.service';
import type { AgencyServicesPort } from '../ports/agency-services.port';
import { AGENCY_SERVICES_PORT } from '../ports/tokens';

export interface AgencyCreationResult {
  node: AgencyNode;
  isNew: boolean;
}

export interface AgencyImportDecisionNode {
  id: string;
  parentNodeId: string | null;
  alias: string | null;
  createdAt: Date;
}

export interface AgencyImportDecisionResult {
  status: 'new' | 'existing' | 'downstream';
  serviceId: string;
  resolvedParentNodeId?: string;
  isDownstream: boolean;
  existingNodes: AgencyImportDecisionNode[];
}

@Injectable()
export class AgencyCreationService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
    @Inject(AGENCY_SERVICES_PORT)
    private readonly servicesPort: AgencyServicesPort,
    private readonly collectionQuotaService: CollectionQuotaService,
    private readonly importService: AgencyImportService,
    private readonly agencyValidationService: AgencyValidationService,
    private readonly agencyPricingService: AgencyPricingService,
    private readonly dataSource: DataSource,
  ) {}

  async ensureOwnerRootNode(ownerId: string, serviceId: string) {
    return this.dataSource.transaction(async (manager) => {
      const service = await this.servicesPort.findActiveServiceById(
        serviceId,
        manager,
      );
      if (!service) {
        throw new NotFoundException('Service not found');
      }
      if (service.owner_id !== ownerId) {
        throw new ForbiddenException('Not service owner');
      }

      const where = {
        agent_id: ownerId,
        service_id: serviceId,
        parent_node_id: IsNull(),
      };
      const existing = await manager.findOne(AgencyNode, { where });
      if (existing) {
        let touched = false;
        if (!existing.share_slug) {
          existing.share_slug = `s${randomBytes(4).toString('hex')}`;
          touched = true;
        }
        if (existing.status === 'DELETED') {
          existing.status = 'ACTIVE';
          touched = true;
        }
        const costPrice = Number(service.base_price);
        if (Number(existing.cache_cost_price) !== costPrice) {
          existing.cache_cost_price = costPrice;
          touched = true;
        }
        const totalPrice = costPrice;
        if (Number(existing.cache_total_price) !== totalPrice) {
          existing.cache_total_price = totalPrice;
          touched = true;
        }
        if (!existing.inherited_name) {
          existing.inherited_name = service.title || null;
          touched = true;
        }
        if (touched) {
          return manager.save(AgencyNode, existing);
        }
        return existing;
      }

      const node = manager.create(AgencyNode, {
        agent_id: ownerId,
        service_id: serviceId,
        parent_node_id: null,
        share_slug: `s${randomBytes(4).toString('hex')}`,
        status: 'ACTIVE',
        markup_type: 'FIXED',
        markup_value: 0,
        markup_amount: 0,
        inherited_name: service.title || null,
        node_type: 'STANDARD',
        compliance_content: null,
        compliance_signature: null,
        cache_cost_price: Number(service.base_price),
        cache_total_price: Number(service.base_price),
      });
      return manager.save(AgencyNode, node);
    });
  }

  async createCollection(
    agentId: string,
    serviceId: string,
    parentNodeId?: string,
    options?: {
      markup_type?: string;
      markup_value?: number;
      markup_amount?: number;
      alias?: string;
      private_notes?: string;
      public_notes?: string;
      compliance_content?: string;
      compliance_signature?: string;
      force_recreate_on_existing?: boolean;
    },
  ): Promise<AgencyCreationResult> {
    return this.dataSource.transaction(async (manager) => {
      const isSqlite = manager.connection.options.type === 'sqlite';
      const lockedUser = await manager.findOne(User, {
        where: { id: agentId },
        ...(!isSqlite ? { lock: { mode: 'pessimistic_write' } } : {}),
      });
      if (!lockedUser) {
        throw new NotFoundException('Agent not found');
      }

      const context =
        await this.agencyValidationService.resolveCreateCollectionContext(
          agentId,
          serviceId,
          parentNodeId,
        );
      const costPrice = context.costPrice;
      const inheritedName = context.inheritedName;
      const resolvedParentNodeId = context.parentNodeId;

      await this.collectionQuotaService.assertCanActivate(agentId, 1);

      const markupType = options?.markup_type ?? 'FIXED';
      const markupValue = options?.markup_value ?? 0;
      if (Number(markupValue) < 0) {
        throw new BadRequestException('markup_value must be >= 0');
      }
      const markupAmount = this.agencyPricingService.calculateMarkupAmount(
        costPrice,
        markupType,
        markupValue,
      );
      if (Number(markupAmount) < 0) {
        throw new BadRequestException('markup_amount must be >= 0');
      }
      const totalPrice = this.agencyPricingService.calculateTotalPrice(
        costPrice,
        markupAmount,
      );

      const complianceContent = options?.compliance_content
        ? String(options.compliance_content).trim()
        : '';
      const complianceSignature = options?.compliance_signature
        ? String(options.compliance_signature).trim()
        : '';
      if (complianceContent.length > 20000) {
        throw new BadRequestException('compliance_content is too long');
      }
      if (complianceSignature.length > 4096) {
        throw new BadRequestException('compliance_signature is too long');
      }

      const hasComplianceContent = Boolean(complianceContent);
      const hasComplianceSignature = Boolean(complianceSignature);
      if (hasComplianceContent !== hasComplianceSignature) {
        throw new BadRequestException(
          'compliance_content and compliance_signature must be provided together',
        );
      }
      const nodeType: AgencyNode['node_type'] =
        hasComplianceContent && hasComplianceSignature
          ? 'CONTRACT'
          : 'STANDARD';

      const node = manager.create(AgencyNode, {
        agent_id: agentId,
        service_id: serviceId,
        parent_node_id: resolvedParentNodeId,
        share_slug: `s${randomBytes(4).toString('hex')}`,
        status: 'ACTIVE',
        markup_amount: markupAmount,
        markup_type: markupType,
        markup_value: markupValue,
        alias: options?.alias,
        inherited_name: inheritedName,
        private_notes: options?.private_notes,
        public_notes: options?.public_notes,
        node_type: nodeType,
        compliance_content: hasComplianceContent ? complianceContent : null,
        compliance_signature: hasComplianceSignature
          ? complianceSignature
          : null,
        cache_cost_price: costPrice,
        cache_total_price: totalPrice,
      });

      const saved = await manager.save(AgencyNode, node);
      return {
        node: saved,
        isNew: true,
      };
    });
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
      compliance_content?: string;
      compliance_signature?: string;
      force_recreate_on_existing?: boolean;
      import_as_child?: boolean;
    },
  ): Promise<AgencyCreationResult> {
    if (!code) throw new BadRequestException('Import code is required');

    const resolveResult = await this.importService.resolveImportCode(code);
    if (!resolveResult) {
      throw new NotFoundException('鏃犳晥鐨勫鍏ョ爜鎴栨湇鍔′笉瀛樺湪');
    }

    const { serviceId, parentNodeId, defaultAlias, defaultPublicNotes } =
      resolveResult;
    const finalAlias = options?.alias || defaultAlias;
    const finalPublicNotes = options?.public_notes || defaultPublicNotes;

    let targetParentNodeId = parentNodeId;

    // If we want to import as a child of the resolved node, we use the resolved node's ID as the parent.
    // This is useful when the user already has a node and wants to create another child node under it.
    if (options?.import_as_child) {
      // Find the user's existing active node for this service
      const existingNode = await this.agencyRepository.findOne({
        where: {
          agent_id: agentId,
          service_id: serviceId,
          status: Not('DELETED'),
        },
        order: { created_at: 'DESC' }, // get the latest one
      });
      if (existingNode) {
        targetParentNodeId = existingNode.id;
      } else if (parentNodeId) {
        targetParentNodeId = parentNodeId;
      }
    }

    return this.createCollection(agentId, serviceId, targetParentNodeId, {
      ...options,
      alias: finalAlias,
      public_notes: finalPublicNotes,
    });
  }

  async importListing(
    agentId: string,
    listingId: number,
    options?: {
      markup_type?: string;
      markup_value?: number;
      alias?: string;
      private_notes?: string;
      public_notes?: string;
      compliance_content?: string;
      compliance_signature?: string;
    },
  ): Promise<AgencyCreationResult> {
    const listing = await this.servicesPort.findListingById(listingId);
    if (!listing) {
      throw new NotFoundException('Product listing not found');
    }

    return this.createCollection(
      agentId,
      listing.source_id,
      undefined,
      options,
    );
  }

  private pickErrorField(error: unknown, key: 'code' | 'message'): string {
    if (typeof error !== 'object' || error === null) return '';
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  }
}
