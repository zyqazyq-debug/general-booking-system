import { Injectable } from '@nestjs/common';
import { OrderService } from '../order.service';
import type { AdminOrderDto, AdminOrderPort } from '../../admin';

@Injectable()
export class AdminOrderAdapter implements AdminOrderPort {
  constructor(private readonly orderService: OrderService) {}

  async findAllForAdmin(): Promise<AdminOrderDto[]> {
    const orders = await this.orderService.findAllForAdmin();
    return orders.map((order) => ({
      id: order.id,
      order_no: order.order_no,
      consumer_id: order.consumer_id,
      owner_id: order.owner_id,
      service_id: order.service_id,
      agency_node_id: order.agency_node_id,
      start_time: order.start_time,
      end_time: order.end_time,
      status: order.status,
      frozen_points: Number(order.frozen_points),
      display_price_snapshot: Number(order.display_price_snapshot),
      created_at: order.created_at,
      updated_at: order.updated_at,
      service: order.service
        ? { id: order.service.id, title: order.service.title }
        : null,
      consumer: order.consumer
        ? {
            id: order.consumer.id,
            username: order.consumer.username,
            nickname: order.consumer.nickname ?? null,
          }
        : null,
      agency_node: order.agency_node
        ? {
            id: order.agency_node.id,
            share_slug: order.agency_node.share_slug,
            agent: order.agency_node.agent
              ? {
                  id: order.agency_node.agent.id,
                  username: order.agency_node.agent.username,
                  nickname: order.agency_node.agent.nickname ?? null,
                }
              : null,
          }
        : null,
    }));
  }
}
