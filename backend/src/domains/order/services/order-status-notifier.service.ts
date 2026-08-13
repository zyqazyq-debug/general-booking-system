import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus } from '../entities/order.entity';

@Injectable()
export class OrderStatusNotifierService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  notifyStatusChange(params: {
    orderId: string;
    serviceId?: string; // Add serviceId if known
    oldStatus: OrderStatus;
    newStatus?: OrderStatus;
  }): void {
    const { orderId, serviceId, oldStatus, newStatus } = params;
    if (!newStatus || newStatus === oldStatus) {
      return;
    }
    this.eventEmitter.emit('order.status.changed', {
      orderId,
      serviceId,
      oldStatus,
      newStatus,
    });
  }
}
