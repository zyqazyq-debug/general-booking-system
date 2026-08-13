import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateServiceBlockDto } from './dto/create-service-block.dto';
import { UpdateServiceBlockDto } from './dto/update-service-block.dto';
import type { ServiceRulesDto } from './dto/service-rules.dto';
import { Service } from './entities/service.entity';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../shared/common/dto/pagination.dto';
import { ServiceBlockService } from './service-block.service';
import { ServiceAvailabilityService } from './service-availability.service';
import type { ServicesAgencyPort } from './ports/services-agency.port';
import { SERVICES_AGENCY_PORT } from './ports/tokens';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private servicesRepository: Repository<Service>,
    private readonly serviceBlockService: ServiceBlockService,
    private readonly serviceAvailabilityService: ServiceAvailabilityService,
    @Inject(SERVICES_AGENCY_PORT)
    private readonly agencyPort: ServicesAgencyPort,
  ) {}

  private async safeInvalidateAvailability(serviceId: string) {
    try {
      await this.serviceAvailabilityService.invalidateCache(serviceId);
    } catch (err) {
      void err;
    }
  }

  async create(createServiceDto: CreateServiceDto) {
    // this.validateRules(createServiceDto);
    const service = this.servicesRepository.create(createServiceDto);
    const saved: Service = await this.servicesRepository.save(service);
    if (saved.is_active) {
      await this.applyInferredGlobalBlocksToService(saved.owner_id, saved.id);
    }
    return saved;
  }

  async findAll(
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<Service>> {
    const { page = 1, limit = 10 } = paginationDto;
    const normalizedPage = Math.max(1, page);
    const skip = (normalizedPage - 1) * limit;

    const [data, total] = await this.servicesRepository.findAndCount({
      where: { is_deleted: false },
      relations: ['owner'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page: normalizedPage,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAllByOwner(
    ownerId: string,
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<Partial<Service> & { share_slug: string }>> {
    const { page = 1, limit = 10 } = paginationDto;
    const normalizedPage = Math.max(1, page);
    const skip = (normalizedPage - 1) * limit;

    const [data, total] = await this.servicesRepository.findAndCount({
      where: { owner_id: ownerId, is_deleted: false },
      select: [
        'id',
        'title',
        'base_price',
        'deposit_points',
        'duration_minutes',
        'is_active',
        'created_at',
        'description',
      ],
      relations: [],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    const nodes = await Promise.all(
      data.map((s) => this.agencyPort.ensureOwnerRootNode(ownerId, s.id)),
    );
    const dataWithSlug: Array<Partial<Service> & { share_slug: string }> =
      data.map((s, idx) => ({
        ...s,
        share_slug: nodes[idx].share_slug,
      }));

    return {
      data: dataWithSlug,
      meta: {
        total,
        page: normalizedPage,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    return this.servicesRepository.findOne({
      where: { id, is_deleted: false },
      relations: ['owner'],
    });
  }

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    this.validateRules(updateServiceDto);
    const service = await this.findOne(id);
    if (!service) throw new NotFoundException('Service not found');
    const wasActive = service.is_active;

    // Explicitly handle boolean update if Object.assign fails for some reason
    if (updateServiceDto.is_active !== undefined) {
      service.is_active = updateServiceDto.is_active;
    }

    Object.assign(service, updateServiceDto);
    const saved: Service = await this.servicesRepository.save(service);
    if (!wasActive && saved.is_active) {
      await this.applyInferredGlobalBlocksToService(saved.owner_id, saved.id);
    }
    await this.agencyPort.propagateScheduleUpdate(id);
    await this.safeInvalidateAvailability(saved.id);
    return saved;
  }

  async remove(id: string) {
    const service = await this.servicesRepository.findOne({
      where: { id },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.is_deleted) {
      return service;
    }
    service.is_active = false;
    service.is_deleted = true;
    const saved: Service = await this.servicesRepository.save(service);
    await this.safeInvalidateAvailability(saved.id);
    return saved;
  }

  private validateRules(dto: {
    rules?: ServiceRulesDto;
    duration_minutes?: number;
  }) {
    if (dto.rules) {
      const { start_hour, end_hour } = dto.rules;
      // Removed the check "start_hour >= end_hour" to allow cross-day (e.g. 20:00 - 04:00)
      if (
        start_hour !== undefined &&
        end_hour !== undefined &&
        start_hour === end_hour
      ) {
        // Maybe allow 24h? For now just prevent equal
        // throw new BadRequestException('Start and End hour cannot be the same');
      }
    }
    if (dto.duration_minutes !== undefined && dto.duration_minutes <= 0) {
      throw new BadRequestException('Duration must be positive');
    }
  }

  async cleanupExpiredBlocks() {
    return this.serviceBlockService.cleanupExpiredBlocks();
  }

  private async applyInferredGlobalBlocksToService(
    ownerId: string,
    serviceId: string,
  ) {
    await this.serviceBlockService.applyInferredGlobalBlocksToService(
      ownerId,
      serviceId,
    );
  }

  async getAvailableSlots(serviceId: string, dateStr: string) {
    return this.serviceAvailabilityService.getAvailableSlots(
      serviceId,
      dateStr,
    );
  }

  async getAvailability(serviceId: string, startDate: string, endDate: string) {
    return this.serviceAvailabilityService.getAvailability(
      serviceId,
      startDate,
      endDate,
    );
  }

  async addBlock(
    serviceId: string,
    userId: string,
    dto: CreateServiceBlockDto,
  ) {
    return this.serviceBlockService.addBlock(serviceId, userId, dto);
  }

  async addGlobalBlock(userId: string, dto: CreateServiceBlockDto) {
    return this.serviceBlockService.addGlobalBlock(userId, dto);
  }

  async getGlobalBlocks(userId: string) {
    return this.serviceBlockService.getGlobalBlocks(userId);
  }

  async updateGlobalBlock(
    blockId: string,
    userId: string,
    dto: UpdateServiceBlockDto,
  ) {
    return this.serviceBlockService.updateGlobalBlock(blockId, userId, dto);
  }

  async removeGlobalBlock(blockId: string, userId: string) {
    return this.serviceBlockService.removeGlobalBlock(blockId, userId);
  }

  async removeBlock(blockId: string, userId: string) {
    return this.serviceBlockService.removeBlock(blockId, userId);
  }
}
