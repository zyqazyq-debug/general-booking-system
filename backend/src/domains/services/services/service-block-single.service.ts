import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateServiceBlockDto } from '../dto/create-service-block.dto';
import { ServiceBlock } from '../entities/service-block.entity';
import { ServiceBlockSupportService } from './service-block-support.service';

@Injectable()
export class ServiceBlockSingleService {
  constructor(
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    private readonly supportService: ServiceBlockSupportService,
  ) {}

  async addBlock(
    serviceId: string,
    userId: string,
    dto: CreateServiceBlockDto,
  ) {
    await this.supportService.assertOwnedService(serviceId, userId);
    const block = this.serviceBlockRepository.create({
      ...dto,
      service_id: serviceId,
    });
    const saved = await this.serviceBlockRepository.save(block);
    await this.supportService.safeInvalidateAvailability(serviceId);
    return saved;
  }

  async removeBlock(blockId: string, userId: string) {
    const block = await this.serviceBlockRepository.findOne({
      where: { id: blockId },
    });
    if (!block) {
      throw new NotFoundException('Block not found');
    }

    await this.supportService.assertOwnedService(block.service_id, userId);
    const result = await this.serviceBlockRepository.delete(blockId);
    await this.supportService.safeInvalidateAvailability(block.service_id);
    return result;
  }
}
