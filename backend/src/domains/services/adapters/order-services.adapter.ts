import { Injectable } from '@nestjs/common';
import { ServicesService } from '../services.service';
import type {
  OrderServicesPort,
  OrderServiceInfoDto,
  OrderServiceSnapshot,
} from '../../order';

@Injectable()
export class OrderServicesAdapter implements OrderServicesPort {
  constructor(private readonly servicesService: ServicesService) {}

  async findServiceById(
    serviceId: string,
  ): Promise<OrderServiceSnapshot | null> {
    return this.servicesService.findOne(serviceId);
  }

  async findServiceInfoById(
    serviceId: string,
  ): Promise<OrderServiceInfoDto | null> {
    const service = await this.servicesService.findOne(serviceId);
    if (!service) return null;
    return {
      id: service.id,
      owner_id: service.owner_id,
      title: service.title,
      base_price: Number(service.base_price),
    };
  }
}
