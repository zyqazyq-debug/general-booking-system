import { Injectable } from '@nestjs/common';
import { CreateServiceBlockDto } from './dto/create-service-block.dto';
import { UpdateServiceBlockDto } from './dto/update-service-block.dto';
import { ServiceBlockSingleService } from './services/service-block-single.service';
import { ServiceBlockGlobalService } from './services/service-block-global.service';
import { ServiceBlockMaintenanceService } from './services/service-block-maintenance.service';
import { ServiceBlockQueryService } from './services/service-block-query.service';
import { ServiceBlockRemovalService } from './services/service-block-removal.service';

@Injectable()
export class ServiceBlockService {
  constructor(
    private readonly singleService: ServiceBlockSingleService,
    private readonly globalService: ServiceBlockGlobalService,
    private readonly maintenanceService: ServiceBlockMaintenanceService,
    private readonly queryService: ServiceBlockQueryService,
    private readonly removalService: ServiceBlockRemovalService,
  ) {}

  async cleanupExpiredBlocks() {
    return this.maintenanceService.cleanupExpiredBlocks();
  }

  async applyInferredGlobalBlocksToService(ownerId: string, serviceId: string) {
    return this.globalService.applyInferredGlobalBlocksToService(
      ownerId,
      serviceId,
    );
  }

  async addBlock(
    serviceId: string,
    userId: string,
    dto: CreateServiceBlockDto,
  ) {
    return this.singleService.addBlock(serviceId, userId, dto);
  }

  async addGlobalBlock(userId: string, dto: CreateServiceBlockDto) {
    return this.globalService.addGlobalBlock(userId, dto);
  }

  async getGlobalBlocks(userId: string) {
    return this.queryService.getGlobalBlocks(userId);
  }

  async updateGlobalBlock(
    blockId: string,
    userId: string,
    dto: UpdateServiceBlockDto,
  ) {
    return this.globalService.updateGlobalBlock(blockId, userId, dto);
  }

  async removeGlobalBlock(blockId: string, userId: string) {
    return this.removalService.removeGlobalBlock(blockId, userId);
  }

  async removeBlock(blockId: string, userId: string) {
    return this.singleService.removeBlock(blockId, userId);
  }
}
