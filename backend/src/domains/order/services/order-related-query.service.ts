import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { CommissionRecord } from '../../agency';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../../shared/common/dto/pagination.dto';
import { OrderWithRoles } from '../types/order-with-roles.type';

@Injectable()
export class OrderRelatedQueryService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async findAllRelated(
    userId: string,
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<OrderWithRoles>> {
    const { page = 1, limit = 10 } = paginationDto;
    const normalizedPage = Math.max(1, page);
    const skip = (normalizedPage - 1) * limit;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.service', 'service')
      .leftJoinAndSelect('order.agency_node', 'agency_node')
      .leftJoinAndSelect('agency_node.agent', 'agent')
      .leftJoinAndSelect('order.consumer', 'consumer')
      .leftJoinAndMapMany(
        'order.commission_records',
        CommissionRecord,
        'cr',
        'cr.order_id = order.id AND cr.agent_id = :userId',
        { userId },
      )
      .where(
        '(order.consumer_id = :userId OR order.owner_id = :userId OR agency_node.agent_id = :userId OR EXISTS (SELECT 1 FROM commission_records cr2 WHERE cr2.order_id = order.id AND cr2.agent_id = :userId))',
        { userId },
      )
      .orderBy('order.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    const [orders, total] = await qb.getManyAndCount();

    const toNumber = (value: unknown) => {
      if (typeof value === 'number') return value;
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    type AgencyNodePricingSnapshot = {
      agent_id: string;
      cache_cost_price: number | string;
      markup_amount: number | string;
      cache_total_price: number | string;
    };

    const result: OrderWithRoles[] = orders.map((order) => {
      const roles: ('CONSUMER' | 'PROVIDER' | 'AGENT')[] = [];
      const commission: Record<string, unknown> = {};
      const agencyNode = (order.agency_node ||
        null) as AgencyNodePricingSnapshot | null;

      if (order.consumer_id === userId) {
        roles.push('CONSUMER');
      }
      if (order.owner_id === userId) {
        roles.push('PROVIDER');
      }
      if (agencyNode?.agent_id === userId) {
        roles.push('AGENT');
      }

      const myCommissions = (order as OrderWithRoles).commission_records;
      if (myCommissions && myCommissions.length > 0) {
        myCommissions.forEach((rec) => {
          if (!roles.includes(rec.role)) {
            roles.push(rec.role);
          }
          commission[rec.role] = {
            cost_price: toNumber(rec.cost_price),
            markup_amount: toNumber(rec.markup_amount),
            final_price: toNumber(rec.final_price),
            level: rec.level,
            child_agent_id: rec.child_agent_id,
          };
        });
      }

      if (roles.includes('PROVIDER') && !commission.PROVIDER) {
        const basePrice = toNumber(order.service_snapshot?.base_price ?? 0);
        commission.PROVIDER = {
          cost_price: 0,
          markup_amount: basePrice,
          final_price: basePrice,
          level: 0,
          child_agent_id: null,
        };
      }

      if (roles.includes('AGENT') && !commission.AGENT && agencyNode) {
        commission.AGENT = {
          cost_price: toNumber(agencyNode.cache_cost_price),
          markup_amount: toNumber(agencyNode.markup_amount),
          final_price: toNumber(agencyNode.cache_total_price),
          level: 0,
          child_agent_id: null,
        };
      }

      const orderWithRoles: OrderWithRoles = {
        ...order,
        roles,
        commission,
      };
      delete orderWithRoles.commission_records;
      return orderWithRoles;
    });

    return {
      data: result,
      meta: {
        total,
        page: normalizedPage,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
