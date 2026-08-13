import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceBlock } from '../entities/service-block.entity';
import { ServiceBlockSupportService } from './service-block-support.service';

@Injectable()
export class ServiceBlockMaintenanceService {
  constructor(
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    private readonly supportService: ServiceBlockSupportService,
  ) {}

  async cleanupExpiredBlocks() {
    const now = new Date();
    const serviceIdRows = await this.serviceBlockRepository
      .createQueryBuilder('block')
      .select('DISTINCT block.service_id', 'service_id')
      .where('block.end_time < :now', { now })
      .getRawMany<{ service_id: string }>();

    const serviceIds = serviceIdRows
      .map((row) => row.service_id)
      .filter((serviceId) => !!serviceId);

    const result = await this.serviceBlockRepository
      .createQueryBuilder()
      .delete()
      .from(ServiceBlock)
      .where('end_time < :now', { now })
      .execute();

    await this.supportService.invalidateServices(serviceIds);
    return result.affected || 0;
  }
}
