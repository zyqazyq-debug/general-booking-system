import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderNotificationService } from '../services/order-notification.service';
import type { OrderCreatedEvent } from '../events/order-created.event';

@Injectable()
export class OrderCreatedNotificationListener implements OnModuleDestroy {
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly orderNotificationService: OrderNotificationService,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(payload: OrderCreatedEvent) {
    if (!payload.eventId) {
      throw new Error('Durable order.created eventId is required');
    }
    const task = this.orderNotificationService.notifyNewOrder(
      payload.orderId,
      payload.eventId,
    );

    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  async onModuleDestroy() {
    const tasks = Array.from(this.inFlight);
    await Promise.allSettled(tasks);
  }
}
