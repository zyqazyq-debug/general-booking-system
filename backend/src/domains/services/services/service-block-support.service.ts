import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ServiceBlock } from '../entities/service-block.entity';
import { Service } from '../entities/service.entity';
import { ServiceAvailabilityService } from '../service-availability.service';

@Injectable()
export class ServiceBlockSupportService {
  constructor(
    @InjectRepository(Service)
    private readonly servicesRepository: Repository<Service>,
    private readonly serviceAvailabilityService: ServiceAvailabilityService,
  ) {}

  async safeInvalidateAvailability(serviceId: string) {
    try {
      await this.serviceAvailabilityService.invalidateCache(serviceId);
    } catch (err) {
      void err;
    }
  }

  async invalidateServices(serviceIds: Iterable<string>) {
    await Promise.all(
      Array.from(new Set(serviceIds)).map((serviceId) =>
        this.safeInvalidateAvailability(serviceId),
      ),
    );
  }

  getBlockSignature(block: ServiceBlock): string {
    return JSON.stringify([
      block.type,
      new Date(block.start_time).toISOString(),
      new Date(block.end_time).toISOString(),
      block.reason || '',
      block.description || '',
      block.notes || '',
    ]);
  }

  async getOwnerServiceIds(ownerId: string, activeOnly = false) {
    const where: FindOptionsWhere<Service> = {
      owner_id: ownerId,
      is_deleted: false,
    };
    if (activeOnly) {
      where.is_active = true;
    }
    const services = await this.servicesRepository.find({
      where,
      select: ['id'],
    });
    return services.map((service) => service.id);
  }

  async getOtherOwnerServiceIds(ownerId: string, excludedServiceId: string) {
    const services = await this.servicesRepository.find({
      where: {
        owner_id: ownerId,
        is_deleted: false,
      },
      select: ['id'],
    });
    return services
      .map((service) => service.id)
      .filter((serviceId) => serviceId !== excludedServiceId);
  }

  async assertOwnedService(serviceId: string, userId: string) {
    const service = await this.servicesRepository.findOne({
      where: { id: serviceId, is_deleted: false },
      select: ['id', 'owner_id'],
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.owner_id !== userId) {
      throw new BadRequestException('You do not own this service');
    }
    return service;
  }
}
