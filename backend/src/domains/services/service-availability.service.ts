import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, Not, In, LessThan, MoreThan } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Service } from './entities/service.entity';
import { ServiceBlock } from './entities/service-block.entity';
import { TimeSlotGenerator, type TimeSlot } from './utils/time-slot-generator';
import type { ServiceRulesDto } from './dto/service-rules.dto';
import type {
  ManagementAvailabilityResponseDto,
  PublicAvailabilityResponseDto,
} from './dto/availability-response.dto';

type OrderRecord = {
  owner_id: string;
  start_time: Date;
  end_time: Date;
  status: string;
};

@Injectable()
export class ServiceAvailabilityService {
  private readonly CACHE_TTL = 300000; // 5 minutes cache
  private readonly logger = new Logger(ServiceAvailabilityService.name);

  constructor(
    @InjectRepository(Service)
    private readonly servicesRepository: Repository<Service>,
    @InjectRepository(ServiceBlock)
    private readonly serviceBlockRepository: Repository<ServiceBlock>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Clears availability cache for a specific service and date range.
   * Should be called when orders or blocks are created/updated/cancelled.
   */
  async invalidateCache(serviceId: string, _dates?: string[]) {
    void _dates;
    // We use a pattern matching approach if supported, or clear specific keys
    // For simplicity, we can just clear specific keys if we know them.
    // However, since we cache by start-end range, exact matching is hard.
    // A better approach for high-concurrency systems is to use a "version" key for the service
    // and include it in the cache key.

    const versionKey = `service_version:${serviceId}`;
    const newVersion = Date.now();
    await this.cacheManager.set(versionKey, newVersion, 86400000);
  }

  private async getServiceVersion(serviceId: string): Promise<number> {
    const versionKey = `service_version:${serviceId}`;
    let version = await this.cacheManager.get<number>(versionKey);
    if (!version) {
      version = Date.now();
      await this.cacheManager.set(versionKey, version, 86400000);
    }
    return version;
  }

  async getAvailableSlots(serviceId: string, dateStr: string) {
    const version = await this.getServiceVersion(serviceId);
    const cacheKey = `slots:${serviceId}:${dateStr}:${version}`;

    const cached = await this.cacheManager.get<TimeSlot[]>(cacheKey);
    if (cached) {
      try {
        const avail = cached.filter((s) => s.status === 'available');
        this.logger.log(
          `Slots[cache] service=${serviceId} date=${dateStr} total=${cached.length} available=${avail.length}`,
        );
        if (avail.length > 0) {
          const preview = avail
            .slice(0, 5)
            .map((s) => `${s.start_time}~${s.end_time}`)
            .join(', ');
          this.logger.log(`Slots[cache] preview=${preview}`);
        }
      } catch {
        void 0;
      }
      return cached;
    }

    const service = await this.servicesRepository.findOne({
      where: { id: serviceId },
    });
    if (!service) throw new NotFoundException('Service not found');

    if (service.is_deleted || !service.is_active) {
      throw new BadRequestException({
        message: 'Service is currently unavailable',
        error_code: 'SERVICE_UNAVAILABLE',
      });
    }

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 2);

    const orderRepository = this.dataSource.getRepository<OrderRecord>('Order');
    const orders = await orderRepository.find({
      where: {
        owner_id: service.owner_id,
        status: Not(In(['CANCELLED', 'FORFEITED'])),
        start_time: LessThan(endOfDay),
        end_time: MoreThan(startOfDay),
      },
    });

    const blocks = await this.serviceBlockRepository.find({
      where: {
        service_id: serviceId,
        start_time: LessThan(endOfDay),
        end_time: MoreThan(startOfDay),
      },
    });

    const result = TimeSlotGenerator.generateSlots(
      service,
      dateStr,
      orders,
      blocks,
    );
    try {
      const rules = (service.rules || null) as ServiceRulesDto | null;
      const weekdaysRaw = Array.isArray(rules?.weekdays) ? rules?.weekdays : [];
      const weekdaysNormalized = weekdaysRaw
        .map((w: number) => (w === 7 ? 0 : Number(w)))
        .join(',');
      const startHour = Number(rules?.start_hour ?? 0);
      const endHour = Number(rules?.end_hour ?? 24);
      const available = result.filter((s) => s.status === 'available');
      this.logger.log(
        `Slots[gen] service=${serviceId} date=${dateStr} rules.weekdays=[${weekdaysNormalized}] hours=${startHour}-${endHour} duration=${service.duration_minutes} buffer=${service.buffer_minutes} orders=${orders.length} blocks=${blocks.length} total=${result.length} available=${available.length}`,
      );
      if (available.length > 0) {
        const preview = available
          .slice(0, 5)
          .map((s) => `${s.start_time}~${s.end_time}`)
          .join(', ');
        this.logger.log(`Slots[gen] preview=${preview}`);
      }
    } catch {
      void 0;
    }
    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async getPublicAvailability(
    serviceId: string,
    startDate: string,
    endDate: string,
  ): Promise<PublicAvailabilityResponseDto> {
    const snapshot = await this.getAvailability(serviceId, startDate, endDate);
    const toWindow = (slot: { start: Date | string; end: Date | string }) => ({
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
    });

    return {
      rules: snapshot.rules,
      busy_slots: snapshot.busy_slots.map(toWindow),
      blocks: snapshot.blocks.map(toWindow),
    };
  }

  async getManagementAvailability(
    serviceId: string,
    startDate: string,
    endDate: string,
  ): Promise<ManagementAvailabilityResponseDto> {
    return this.getAvailability(serviceId, startDate, endDate);
  }

  async getAvailability(
    serviceId: string,
    startDate: string,
    endDate: string,
  ): Promise<ManagementAvailabilityResponseDto> {
    const version = await this.getServiceVersion(serviceId);
    // Round dates to hour or day to increase cache hit rate?
    // No, users might query arbitrary ranges.
    // But typically frontend queries by month or week.
    const cacheKey = `avail:${serviceId}:${startDate}:${endDate}:${version}`;

    const cached =
      await this.cacheManager.get<ManagementAvailabilityResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const service = await this.servicesRepository.findOne({
      where: { id: serviceId },
      relations: ['owner'],
    });
    if (!service) throw new NotFoundException('Service not found');

    if (service.is_deleted || !service.is_active) {
      throw new BadRequestException({
        message: 'Service is currently unavailable',
        error_code: 'SERVICE_UNAVAILABLE',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      throw new BadRequestException('Start date must be before end date');
    }

    const orderRepository = this.dataSource.getRepository<OrderRecord>('Order');
    const orders = await orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.service', 'service')
      .where('service.owner_id = :ownerId', { ownerId: service.owner_id })
      .andWhere('order.status != :cancelled', { cancelled: 'CANCELLED' })
      .andWhere('order.start_time < :end', { end })
      .andWhere('order.end_time > :start', { start })
      .orderBy('order.start_time', 'ASC')
      .getMany();

    const blocks = await this.serviceBlockRepository
      .createQueryBuilder('block')
      .where('block.service_id = :serviceId', { serviceId })
      .andWhere('block.start_time <= :end', { end })
      .andWhere('block.end_time >= :start', { start })
      .getMany();

    const bufferMs = (service.buffer_minutes || 0) * 60 * 1000;

    const busySlots = orders.map((o) => {
      const originalEnd = new Date(o.end_time);
      const bufferedEnd = new Date(originalEnd.getTime() + bufferMs);

      return {
        start: o.start_time,
        end: bufferedEnd.toISOString(),
      };
    });

    const blockSlots = blocks.map((b) => ({
      id: b.id,
      start: b.start_time,
      end: b.end_time,
      type: b.type,
      reason: b.reason,
      description: b.description,
      notes: b.notes,
    }));

    const result = {
      rules: {
        weekdays:
          (service.rules as ServiceRulesDto | undefined)?.weekdays || [],
        start_hour: (service.rules as ServiceRulesDto | undefined)?.start_hour,
        end_hour: (service.rules as ServiceRulesDto | undefined)?.end_hour,
        duration_minutes: service.duration_minutes,
        buffer_minutes: service.buffer_minutes,
      },
      busy_slots: busySlots,
      blocks: blockSlots,
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }
}
