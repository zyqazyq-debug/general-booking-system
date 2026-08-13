import { Injectable } from '@nestjs/common';

import { ServicesService } from '../services.service';

@Injectable()
export class PlatformServicesAdapter {
  constructor(private readonly servicesService: ServicesService) {}

  async getAvailableSlots(
    serviceId: string,
    dateStr: string,
  ): Promise<unknown> {
    return this.servicesService.getAvailableSlots(serviceId, dateStr);
  }
}
