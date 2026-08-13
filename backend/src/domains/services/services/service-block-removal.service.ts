import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ServiceBlock } from '../entities/service-block.entity';
import { ServiceBlockSupportService } from './service-block-support.service';

@Injectable()
export class ServiceBlockRemovalService {
  constructor(
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    private readonly supportService: ServiceBlockSupportService,
  ) {}

  async removeGlobalBlock(blockId: string, userId: string) {
    const anchor = await this.serviceBlockRepository.findOne({
      where: { id: blockId },
    });
    if (!anchor) {
      throw new NotFoundException('Block not found');
    }

    await this.supportService.assertOwnedService(anchor.service_id, userId);

    const serviceIds = await this.supportService.getOwnerServiceIds(userId);
    if (serviceIds.length === 0) {
      throw new NotFoundException('No owned services found');
    }

    const allBlocks = await this.serviceBlockRepository.find({
      where: { service_id: In(serviceIds) },
    });
    const anchorSignature = this.supportService.getBlockSignature(anchor);
    const matchedBlocks = allBlocks.filter(
      (block) =>
        this.supportService.getBlockSignature(block) === anchorSignature,
    );
    const matchedBlockIds = matchedBlocks.map((block) => block.id);

    if (matchedBlockIds.length === 0) {
      return { deleted_count: 0 };
    }

    const result = await this.serviceBlockRepository.delete(matchedBlockIds);
    await this.supportService.invalidateServices(
      matchedBlocks.map((block) => block.service_id),
    );
    return {
      deleted_count: result.affected || 0,
    };
  }
}
