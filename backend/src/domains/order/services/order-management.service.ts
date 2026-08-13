import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { OrderQueryService } from './order-query.service';
import { OrderAdminQueryService } from './order-admin-query.service';
import { OrderStatusNotifierService } from './order-status-notifier.service';
import { OrderUpdateGuardService } from './order-update-guard.service';

@Injectable()
export class OrderManagementService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly orderQueryService: OrderQueryService,
    private readonly orderAdminQueryService: OrderAdminQueryService,
    private readonly orderStatusNotifierService: OrderStatusNotifierService,
    private readonly orderUpdateGuardService: OrderUpdateGuardService,
  ) {}

  findAllForAdmin() {
    return this.orderAdminQueryService.findAllForAdmin();
  }

  async update(id: string, updateOrderDto: UpdateOrderDto, actorId: string) {
    const order = await this.orderQueryService.findOneWithContext(id, actorId);
    if (!order) throw new NotFoundException('Order not found');
    const oldStatus = order.status;
    this.orderUpdateGuardService.assertUpdatable(
      order as any as Order,
      updateOrderDto,
      actorId,
    );

    const result = await this.orderRepository.update(id, updateOrderDto);
    this.orderStatusNotifierService.notifyStatusChange({
      orderId: id,
      serviceId: order.service_id ?? undefined,
      oldStatus,
      newStatus: updateOrderDto.status,
    });
    return result;
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
