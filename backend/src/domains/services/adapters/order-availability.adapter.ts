import { Injectable } from '@nestjs/common';
import { ServiceAvailabilityService } from '../service-availability.service';
import type { OrderAvailabilityPort } from '../../order';

@Injectable()
export class OrderAvailabilityAdapter implements OrderAvailabilityPort {
  constructor(
    private readonly serviceAvailabilityService: ServiceAvailabilityService,
  ) {}

  async invalidateCache(serviceId: string): Promise<void> {
    await this.serviceAvailabilityService.invalidateCache(serviceId);
  }
}
