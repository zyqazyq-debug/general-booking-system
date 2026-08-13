import { Injectable } from '@nestjs/common';
import { AgencyPricingService } from './services/agency-pricing.service';
import { AgencyTreeService } from './services/agency-tree.service';
import { AgencyAvailabilityService } from './services/agency-availability.service';
import { AgencyCollectionMutationService } from './services/agency-collection-mutation.service';
import { AgencyQueryService } from './services/agency-query.service';
import {
  AgencyCreationService,
  AgencyCreationResult,
} from './services/agency-creation.service';
import {
  AgencyImportService,
  PreCheckImportResult,
} from './services/agency-import.service';

@Injectable()
export class AgencyService {
  constructor(
    private readonly agencyPricingService: AgencyPricingService,
    private readonly agencyTreeService: AgencyTreeService,
    private readonly agencyAvailabilityService: AgencyAvailabilityService,
    private readonly agencyCollectionMutationService: AgencyCollectionMutationService,
    private readonly agencyQueryService: AgencyQueryService,
    private readonly agencyCreationService: AgencyCreationService,
    private readonly agencyImportService: AgencyImportService,
  ) {}

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
    },
  ): Promise<AgencyCreationResult> {
    return this.agencyCreationService.createCollection(
      agentId,
      serviceId,
      parentNodeId,
      options,
    );
  }

  async ensureOwnerRootNode(ownerId: string, serviceId: string) {
    return this.agencyCreationService.ensureOwnerRootNode(ownerId, serviceId);
  }

  /**
   * Unified import method for all frontends (Web, Telegram, CLI, etc.)
   * Resolves the code (slug/token) and creates a collection.
   */
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
    return this.agencyCreationService.importCollection(agentId, code, options);
  }

  async preCheckImport(
    agentId: string,
    code: string,
  ): Promise<PreCheckImportResult> {
    return this.agencyImportService.preCheckImport(agentId, code);
  }

  // ... (resolveImportCode removed)

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
    return this.agencyCreationService.importListing(
      agentId,
      listingId,
      options,
    );
  }

  async getMyCollection(agentId: string) {
    return this.agencyQueryService.getMyCollection(agentId);
  }

  async getCollectionAvailability(agentId: string, dateStr: string) {
    return this.agencyAvailabilityService.getCollectionAvailability(
      agentId,
      dateStr,
    );
  }

  async removeCollection(agentId: string, nodeId: string) {
    return this.agencyCollectionMutationService.removeCollection(
      agentId,
      nodeId,
    );
  }

  async setCollectionStatus(
    agentId: string,
    nodeId: string,
    isActive: boolean,
  ) {
    return this.agencyCollectionMutationService.setCollectionStatus(
      agentId,
      nodeId,
      isActive,
    );
  }

  async findAll() {
    return this.agencyQueryService.findAll();
  }

  async reparentCollection(
    agentId: string,
    nodeId: string,
    newParentNodeId: string,
  ) {
    return this.agencyCollectionMutationService.reparentCollection(
      agentId,
      nodeId,
      newParentNodeId,
    );
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
  ) {
    return this.agencyCollectionMutationService.updateCollection(
      agentId,
      nodeId,
      data,
    );
  }

  async propagateScheduleUpdate(serviceId: string) {
    return this.agencyPricingService.propagateScheduleUpdate(serviceId);
  }

  async findById(id: string) {
    return this.agencyQueryService.findById(id);
  }

  async validateActiveChain(nodeId: string) {
    return this.agencyTreeService.validateActiveChain(nodeId);
  }

  async findByAgentAndService(
    agentId: string,
    serviceId: string,
    includeInactive = false,
  ) {
    return this.agencyQueryService.findByAgentAndService(
      agentId,
      serviceId,
      includeInactive,
    );
  }

  async findOne(id: string) {
    return this.agencyQueryService.findOne(id);
  }

  async findBySlug(slug: string) {
    return this.agencyQueryService.findBySlug(slug);
  }
}
