import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { Order, OrderStatus } from '../entities/order.entity';

@Injectable()
export class OrderUpdateGuardService {
  assertUpdatable(
    order: Order,
    updateOrderDto: UpdateOrderDto,
    actorId: string,
  ): void {
    const payload = updateOrderDto as Record<string, unknown>;

    // 1. Basic field protection
    if (payload.consumer_id) {
      throw new BadRequestException('Cannot transfer order ownership');
    }

    // 2. Status transition protection
    if (updateOrderDto.status && updateOrderDto.status !== order.status) {
      this.validateStatusTransition(order, updateOrderDto.status, actorId);
    }
  }

  private validateStatusTransition(
    order: Order,
    newStatus: OrderStatus,
    actorId: string,
  ): void {
    const isConsumer = order.consumer_id === actorId;
    const isProvider = order.owner_id === actorId;

    // Simplified state machine logic
    switch (newStatus) {
      case OrderStatus.CANCELLED:
        if (!isConsumer && !isProvider) {
          throw new ForbiddenException('Only owner can cancel order');
        }
        if (
          order.status !== OrderStatus.PENDING &&
          order.status !== OrderStatus.RESERVED
        ) {
          throw new BadRequestException(
            `Cannot cancel order in ${order.status} state`,
          );
        }
        break;

      case OrderStatus.COMPLETED:
        if (!isProvider) {
          throw new ForbiddenException('Only provider can complete order');
        }
        if (order.status !== OrderStatus.RESERVED) {
          throw new BadRequestException(
            'Only reserved orders can be completed',
          );
        }
        break;

      default:
        // Other transitions might need more complex logic
        break;
    }
  }
}
