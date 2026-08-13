import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderStatus } from '../entities/order.entity';
import { OrderNotificationService } from '../services/order-notification.service';

@Injectable()
export class OrderStatusNotificationListener {
  constructor(
    private readonly orderNotificationService: OrderNotificationService,
  ) {}

  @OnEvent('order.status.changed')
  async handleOrderStatusChanged(payload: {
    orderId: string;
    oldStatus: OrderStatus;
    newStatus: OrderStatus;
  }) {
    await this.orderNotificationService.notifyOrderStatusChange(
      payload.orderId,
      payload.newStatus,
    );
  }
}
