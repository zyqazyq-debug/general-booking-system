import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Order } from '../entities/order.entity';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';

@Injectable()
export class OrderOwnerQueryService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async findAllByOwner(
    ownerId: string,
    paginationDto: PaginationDto = new PaginationDto(),
    startTime?: string,
    endTime?: string,
  ): Promise<PaginatedResponseDto<Order>> {
    const { page = 1, limit = 10 } = paginationDto;
    const normalizedPage = Math.max(1, page);
    const skip = (normalizedPage - 1) * limit;

    const where: FindOptionsWhere<Order> = {
      owner_id: ownerId,
    };

    if (startTime && endTime) {
      where.start_time = Between(new Date(startTime), new Date(endTime));
    } else if (startTime) {
      where.start_time = MoreThanOrEqual(new Date(startTime));
    } else if (endTime) {
      where.start_time = LessThanOrEqual(new Date(endTime));
    }

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      relations: ['service', 'consumer', 'agency_node', 'agency_node.agent'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page: normalizedPage,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
