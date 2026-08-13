import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ServiceBlock } from '../entities/service-block.entity';
import { ServiceBlockSupportService } from './service-block-support.service';

@Injectable()
export class ServiceBlockQueryService {
  constructor(
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    private readonly supportService: ServiceBlockSupportService,
  ) {}

  async getGlobalBlocks(userId: string) {
    const serviceIds = await this.supportService.getOwnerServiceIds(
      userId,
      true,
    );
    if (serviceIds.length === 0) {
      return [];
    }

    const blocks = await this.serviceBlockRepository.find({
      where: { service_id: In(serviceIds) },
      order: { start_time: 'ASC' },
    });

    const grouped = new Map<
      string,
      { sample: ServiceBlock; blockIds: string[]; serviceIds: Set<string> }
    >();

    for (const block of blocks) {
      const signature = this.supportService.getBlockSignature(block);
      if (!grouped.has(signature)) {
        grouped.set(signature, {
          sample: block,
          blockIds: [],
          serviceIds: new Set<string>(),
        });
      }
      const item = grouped.get(signature)!;
      item.blockIds.push(block.id);
      item.serviceIds.add(block.service_id);
    }

    return Array.from(grouped.values())
      .map((item) => ({
        id: item.sample.id,
        type: item.sample.type,
        start_time: item.sample.start_time,
        end_time: item.sample.end_time,
        reason: item.sample.reason,
        description: item.sample.description,
        notes: item.sample.notes,
        block_count: item.blockIds.length,
        service_count: item.serviceIds.size,
        total_service_count: serviceIds.length,
        is_global: item.serviceIds.size === serviceIds.length,
      }))
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
  }
}
