import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { ORDER_USERS_PORT, ORDER_SERVICES_PORT } from '../ports/tokens';
import type {
  OrderUserSnapshot,
  OrderUsersPort,
} from '../ports/order-users.port';
import type { OrderServicesPort } from '../ports/order-services.port';

type CreditSummaryRaw = {
  frozen_total: string | null;
  reserved_count: string | null;
};

@Injectable()
export class OrderFinancialService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject(ORDER_USERS_PORT)
    private readonly usersPort: OrderUsersPort,
    @Inject(ORDER_SERVICES_PORT)
    private readonly servicesPort: OrderServicesPort,
  ) {}

  async getCreditSummary(userOrId: string | OrderUserSnapshot) {
    let user: OrderUserSnapshot | null = null;
    if (typeof userOrId === 'string') {
      user = await this.usersPort.findUserById(userOrId);
    } else {
      user = userOrId;
    }

    if (!user) throw new NotFoundException('User not found');
    const userId = user.id;

    const raw = await this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.frozen_points), 0)', 'frozen_total')
      .addSelect('COUNT(1)', 'reserved_count')
      .where('order.consumer_id = :userId', { userId })
      .andWhere('order.status = :status', { status: OrderStatus.RESERVED })
      .getRawOne<CreditSummaryRaw>();

    const availableCredit = Number(user.credit_balance || 0);
    const frozenTotal = Number(raw?.frozen_total || 0);
    const reservedCount = Number(raw?.reserved_count || 0);

    return {
      available_credit: availableCredit,
      frozen_total: frozenTotal,
      active_reserved_orders: reservedCount,
      credit_total: Number((availableCredit + frozenTotal).toFixed(2)),
      purchase_endpoint: '/users/me/credit/purchase-intent',
    };
  }

  async checkCreditForService(userId: string, serviceId: string) {
    if (!serviceId) {
      throw new BadRequestException('serviceId is required');
    }

    const service = await this.servicesPort.findServiceById(serviceId);
    if (!service) throw new NotFoundException('Service not found');

    const user = await this.usersPort.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');

    const requiredCredit = Number(service.deposit_points || 0);
    const availableCredit = Number(user.credit_balance || 0);
    const shortfall = Number(
      Math.max(0, requiredCredit - availableCredit).toFixed(2),
    );

    return {
      can_book: shortfall <= 0,
      required_credit: requiredCredit,
      available_credit: availableCredit,
      shortfall,
      purchase_endpoint: '/users/me/credit/purchase-intent',
    };
  }

  async freezeDepositCredit(
    consumerId: string,
    depositPoints: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersPort.freezeCredit(consumerId, depositPoints, manager);
  }

  async unfreezeDepositCredit(
    consumerId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersPort.unfreezeCredit(consumerId, amount, manager);
  }

  async burnDepositCredit(
    consumerId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersPort.burnCredit(consumerId, amount, manager);
  }

  async transferFrozenPenalty(
    consumerId: string,
    providerId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await this.usersPort.transferFrozenCredit(
      consumerId,
      providerId,
      amount,
      manager,
    );
  }
}
