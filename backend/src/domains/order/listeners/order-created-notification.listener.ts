import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderNotificationService } from '../services/order-notification.service';
import type { OrderCreatedEvent } from '../events/order-created.event';

@Injectable()
export class OrderCreatedNotificationListener implements OnModuleDestroy {
  private readonly logger = new Logger(OrderCreatedNotificationListener.name);
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly orderNotificationService: OrderNotificationService,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(payload: OrderCreatedEvent) {
    const task = (async () => {
      try {
        await this.orderNotificationService.notifyNewOrder(payload.orderId);
      } catch (err) {
        this.logger.error('Failed to send order created notification', err);
      }
    })();

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
