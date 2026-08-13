import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { OrderAvailabilityPort } from '../ports/order-availability.port';
import { ORDER_AVAILABILITY_PORT } from '../ports/tokens';
import type { OrderCreatedEvent } from '../events/order-created.event';

@Injectable()
export class OrderAvailabilityCacheListener implements OnModuleDestroy {
  private readonly logger = new Logger(OrderAvailabilityCacheListener.name);
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    @Inject(ORDER_AVAILABILITY_PORT)
    private readonly availabilityPort: OrderAvailabilityPort,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(payload: OrderCreatedEvent) {
    const serviceId = payload.serviceId;
    if (!serviceId) return;
    const task = (async () => {
      try {
        await this.availabilityPort.invalidateCache(serviceId);
        this.logger.debug(
          `Invalidated availability cache for service ${serviceId} due to new order ${payload.orderId}`,
        );
      } catch (e) {
        this.logger.error(
          `Failed to invalidate cache for service ${serviceId}`,
          e,
        );
      }
    })();

    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  @OnEvent('order.status.changed')
  async handleOrderStatusChanged(payload: {
    orderId: string;
    serviceId?: string;
    oldStatus: string;
    newStatus: string;
  }) {
    const serviceId = payload.serviceId;
    if (!serviceId) return;

    // Only invalidate if the status change affects availability
    const statusAffectsAvailability = [
      'CANCELLED',
      'FORFEITED',
      'COMPLETED',
      'RESERVED',
    ].includes(payload.newStatus);

    if (statusAffectsAvailability) {
      const task = (async () => {
        try {
          await this.availabilityPort.invalidateCache(serviceId);
          this.logger.debug(
            `Invalidated availability cache for service ${serviceId} due to order ${payload.orderId} status change`,
          );
        } catch (e) {
          this.logger.error(
            `Failed to invalidate cache for service ${serviceId}`,
            e,
          );
        }
      })();

      this.inFlight.add(task);
      try {
        await task;
      } finally {
        this.inFlight.delete(task);
      }
    }
  }

  async onModuleDestroy() {
    const tasks = Array.from(this.inFlight);
    await Promise.allSettled(tasks);
  }
}
