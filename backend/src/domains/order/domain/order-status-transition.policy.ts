import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../entities/order.entity';
import { ORDER_CANCELLATION_BLOCKED_STATUSES } from './order-lifecycle.types';

export class OrderStatusTransitionPolicy {
  static ensureConfirmable(status: OrderStatus) {
    if (status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order status is not PENDING');
    }
  }

  static evaluateCompletion(status: OrderStatus) {
    if (status === OrderStatus.COMPLETED) {
      return 'ALREADY_COMPLETED' as const;
    }

    if (status !== OrderStatus.RESERVED) {
      throw new BadRequestException('Order must be RESERVED to complete');
    }

    return 'READY_TO_COMPLETE' as const;
  }

  static ensureForfeitable(status: OrderStatus) {
    if (status !== OrderStatus.RESERVED) {
      throw new BadRequestException('Order must be RESERVED to forfeit');
    }
  }

  static ensureDisputable(status: OrderStatus) {
    if (status !== OrderStatus.FORFEITED) {
      throw new BadRequestException('Order must be FORFEITED to dispute');
    }
  }

  static ensureCancellable(status: OrderStatus) {
    if (ORDER_CANCELLATION_BLOCKED_STATUSES.includes(status)) {
      throw new BadRequestException('Order cannot be cancelled');
    }
  }
}
