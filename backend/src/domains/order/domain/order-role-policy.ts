import { BadRequestException } from '@nestjs/common';
import type {
  OrderLifecycleActorRole,
  OrderLifecycleRecord,
} from './order-lifecycle.types';

export class OrderRolePolicy {
  static isConsumer(order: OrderLifecycleRecord, actorId: string) {
    return order.consumer_id === actorId;
  }

  static isProvider(order: OrderLifecycleRecord, actorId: string) {
    return order.owner_id === actorId || order.service?.owner_id === actorId;
  }

  static ensureProviderAction(
    order: OrderLifecycleRecord,
    actorId: string,
    action: 'confirm' | 'complete' | 'forfeit',
  ) {
    if (!this.isProvider(order, actorId)) {
      throw new BadRequestException(`Not authorized to ${action} this order`);
    }
  }

  static ensureConsumerAction(
    order: OrderLifecycleRecord,
    actorId: string,
    action: 'dispute',
  ) {
    if (!this.isConsumer(order, actorId)) {
      throw new BadRequestException(`Not authorized to ${action} this order`);
    }
  }

  static resolveCancellationActorRole(
    order: OrderLifecycleRecord,
    actorId: string,
  ): OrderLifecycleActorRole {
    const isConsumer = this.isConsumer(order, actorId);
    const isProvider = this.isProvider(order, actorId);

    if (!isConsumer && !isProvider) {
      throw new BadRequestException('Not authorized to cancel this order');
    }

    return isProvider ? 'PROVIDER' : 'CONSUMER';
  }
}
