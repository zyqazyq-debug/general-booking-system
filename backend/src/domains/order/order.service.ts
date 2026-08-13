import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Order } from './entities/order.entity';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../shared/common/dto/pagination.dto';
import { OrderWithRoles } from './types/order-with-roles.type';
import { OrderFinancialService } from './services/order-financial.service';
import { OrderQueryService } from './services/order-query.service';
import { OrderTaskService } from './services/order-task.service';
import { OrderLifecycleService } from './services/order-lifecycle.service';
import { OrderCreationService } from './services/order-creation.service';
import { OrderManagementService } from './services/order-management.service';
import type { OrderUserSnapshot } from './ports/order-users.port';

@Injectable()
export class OrderService {
  constructor(
    private orderCreationService: OrderCreationService,
    private orderFinancialService: OrderFinancialService,
    private orderQueryService: OrderQueryService,
    private orderTaskService: OrderTaskService,
    private orderLifecycleService: OrderLifecycleService,
    private orderManagementService: OrderManagementService,
  ) {}

  async create(createOrderDto: CreateOrderDto) {
    return this.orderCreationService.create(createOrderDto);
  }

  async confirm(id: string, actorId: string) {
    return this.orderLifecycleService.confirm(id, actorId);
  }

  async complete(id: string, actorId: string) {
    return this.orderLifecycleService.complete(id, actorId);
  }

  async forfeit(id: string, actorId: string) {
    return this.orderLifecycleService.forfeit(id, actorId);
  }

  async dispute(id: string, actorId: string) {
    return this.orderLifecycleService.dispute(id, actorId);
  }

  async noShow(id: string, actorId: string) {
    return this.orderLifecycleService.forfeit(id, actorId);
  }

  async handleAutoCompletion() {
    return this.orderTaskService.handleAutoCompletion();
  }

  async cancel(id: string, actorId: string, reason?: string) {
    return this.orderLifecycleService.cancel(id, actorId, reason);
  }

  findAllForAdmin() {
    return this.orderManagementService.findAllForAdmin();
  }

  findAll() {
    // This method is dangerous if exposed to all users.
    // It should probably be admin-only or removed.
    // For now, I'll leave it but warn/restrict in controller.
    // Ideally, throw error or require admin role check here.
    throw new BadRequestException('Use specific find methods instead');
  }

  async getCreditSummary(userOrId: string | OrderUserSnapshot) {
    return this.orderFinancialService.getCreditSummary(userOrId);
  }

  async checkCreditForService(userId: string, serviceId: string) {
    return this.orderFinancialService.checkCreditForService(userId, serviceId);
  }

  async findAllRelated(
    userId: string,
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<OrderWithRoles>> {
    return this.orderQueryService.findAllRelated(userId, paginationDto);
  }

  async findAllByOwner(
    ownerId: string,
    paginationDto: PaginationDto = new PaginationDto(),
    startTime?: string,
    endTime?: string,
  ): Promise<PaginatedResponseDto<Order>> {
    return this.orderQueryService.findAllByOwner(
      ownerId,
      paginationDto,
      startTime,
      endTime,
    );
  }

  async findOne(id: string, actorId?: string) {
    return this.orderQueryService.findOneWithContext(id, actorId);
  }

  async update(id: string, updateOrderDto: UpdateOrderDto, actorId: string) {
    return this.orderManagementService.update(id, updateOrderDto, actorId);
  }

  async remove(id: string, actorId: string) {
    return this.orderManagementService.remove(id, actorId);
  }
}
