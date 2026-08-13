import { Injectable } from '@nestjs/common';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';
import { OrderWithRoles } from '../types/order-with-roles.type';
import { OrderContextQueryService } from './order-context-query.service';
import { OrderRelatedQueryService } from './order-related-query.service';
import { OrderOwnerQueryService } from './order-owner-query.service';
import { Order } from '../entities/order.entity';

@Injectable()
export class OrderQueryService {
  constructor(
    private readonly orderContextQueryService: OrderContextQueryService,
    private readonly orderRelatedQueryService: OrderRelatedQueryService,
    private readonly orderOwnerQueryService: OrderOwnerQueryService,
  ) {}

  async findAllRelated(
    userId: string,
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<OrderWithRoles>> {
    return this.orderRelatedQueryService.findAllRelated(userId, paginationDto);
  }

  async findAllByOwner(
    ownerId: string,
    paginationDto: PaginationDto = new PaginationDto(),
    startTime?: string,
    endTime?: string,
  ): Promise<PaginatedResponseDto<Order>> {
    return this.orderOwnerQueryService.findAllByOwner(
      ownerId,
      paginationDto,
      startTime,
      endTime,
    );
  }

  async findOneWithContext(id: string, actorId?: string) {
    return this.orderContextQueryService.findOneWithContext(id, actorId);
  }
}
