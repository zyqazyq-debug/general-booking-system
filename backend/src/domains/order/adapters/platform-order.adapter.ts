import { Injectable } from '@nestjs/common';

import { OrderService } from '../order.service';
import type { Order } from '../entities/order.entity';
import type { CreateOrderCommand } from '../dto/create-order.dto';

export type PlatformOrderDto = {
  id: string;
  order_no: string;
  display_price_snapshot: number;
  service_id: string | null;
  consumer_id: string;
  owner_id: string;
  agency_node_id: string | null;
  start_time: Date;
  end_time: Date;
  status: string;
};

@Injectable()
export class PlatformOrderAdapter {
  constructor(private readonly orderService: OrderService) {}

  private mapOrder(order: Order): PlatformOrderDto {
    return {
      id: order.id,
      order_no: order.order_no,
      display_price_snapshot: order.display_price_snapshot,
      service_id: order.service_id,
      consumer_id: order.consumer_id,
      owner_id: order.owner_id,
      agency_node_id: order.agency_node_id,
      start_time: order.start_time,
      end_time: order.end_time,
      status: order.status,
    };
  }

  async create(params: {
    consumer_id: string;
    service_id: string;
    start_time: string;
    end_time: string;
    agency_node_id?: string;
    source_idempotency_key?: string;
  }): Promise<PlatformOrderDto> {
    const dto: CreateOrderCommand = {
      consumer_id: params.consumer_id,
      service_id: params.service_id,
      start_time: params.start_time,
      end_time: params.end_time,
      agency_node_id: params.agency_node_id,
      source_idempotency_key: params.source_idempotency_key,
    };
    const order = await this.orderService.create(dto);
    return this.mapOrder(order);
  }
}
