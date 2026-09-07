import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderQueryService } from './order-query.service';
import { OrderAdminQueryService } from './order-admin-query.service';

@Injectable()
export class OrderManagementService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly orderQueryService: OrderQueryService,
    private readonly orderAdminQueryService: OrderAdminQueryService,
  ) {}

  findAllForAdmin() {
    return this.orderAdminQueryService.findAllForAdmin();
  }

  async remove(id: string, actorId: string) {
    const order = await this.orderQueryService.findOneWithContext(id, actorId);
    if (!order) throw new NotFoundException('Order not found');

    const isConsumer = order.consumer_id === actorId;
    const isProvider = order.owner_id === actorId;

    if (!isConsumer && !isProvider) {
      throw new ForbiddenException('Not authorized to delete this order');
    }

    if (order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Only cancelled orders can be deleted');
    }

    return this.orderRepository.delete(id);
  }
}
