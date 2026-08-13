import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderFinancialService } from './order-financial.service';
import { OrderStatusNotifierService } from './order-status-notifier.service';
import { OrderRolePolicy } from '../domain/order-role-policy';
import { OrderStatusTransitionPolicy } from '../domain/order-status-transition.policy';
import { OrderCancellationSettlementPolicy } from '../domain/order-cancellation-settlement.policy';

@Injectable()
export class OrderLifecycleService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly orderFinancialService: OrderFinancialService,
    private readonly orderStatusNotifierService: OrderStatusNotifierService,
  ) {}

  async confirm(id: string, actorId: string) {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['service'],
    });
    if (!order) throw new NotFoundException('Order not found');

    OrderRolePolicy.ensureProviderAction(order, actorId, 'confirm');
    OrderStatusTransitionPolicy.ensureConfirmable(order.status);

    const oldStatus = order.status;
    order.status = OrderStatus.RESERVED;
    const saved = await this.orderRepository.save(order);
    this.notifyStatusChange({
      orderId: id,
      serviceId: order.service_id ?? undefined,
      oldStatus,
      newStatus: saved.status,
    });
    return saved;
  }

  async complete(id: string, actorId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let oldStatus: OrderStatus;
    let serviceId: string | undefined;
    let saved: Order;

    try {
      const order = await queryRunner.manager.findOne(Order, {
        where: { id },
        relations: ['service'],
      });
      if (!order) throw new NotFoundException('Order not found');

      OrderRolePolicy.ensureProviderAction(order, actorId, 'complete');

      const lockedOrder = await queryRunner.manager.findOne(Order, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder) throw new NotFoundException('Order not found');
      const completionState = OrderStatusTransitionPolicy.evaluateCompletion(
        lockedOrder.status,
      );
      if (completionState === 'ALREADY_COMPLETED') {
        await queryRunner.commitTransaction();
        return lockedOrder;
      }

      oldStatus = lockedOrder.status;
      serviceId = lockedOrder.service_id ?? undefined;

      await this.orderFinancialService.unfreezeDepositCredit(
        lockedOrder.consumer_id,
        lockedOrder.frozen_points,
        queryRunner.manager,
      );

      lockedOrder.status = OrderStatus.COMPLETED;
      lockedOrder.metadata = {
        ...(lockedOrder.metadata || {}),
        completed_by: actorId,
        completed_at: new Date(),
        completed_role: 'PROVIDER',
      };

      saved = await queryRunner.manager.save(Order, lockedOrder);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (saved) {
      this.notifyStatusChange({
        orderId: id,
        serviceId,
        oldStatus,
        newStatus: saved.status,
      });
    }
    return saved;
  }

  async forfeit(id: string, actorId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let oldStatus: OrderStatus;
    let serviceId: string | undefined;
    let saved: Order;

    try {
      const order = await queryRunner.manager.findOne(Order, {
        where: { id },
        relations: ['service'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');

      OrderRolePolicy.ensureProviderAction(order, actorId, 'forfeit');
      OrderStatusTransitionPolicy.ensureForfeitable(order.status);

      oldStatus = order.status;
      serviceId = order.service_id ?? undefined;

      await this.orderFinancialService.burnDepositCredit(
        order.consumer_id,
        order.frozen_points,
        queryRunner.manager,
      );
      order.status = OrderStatus.FORFEITED;
      saved = await queryRunner.manager.save(Order, order);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (saved) {
      this.notifyStatusChange({
        orderId: id,
        serviceId,
        oldStatus,
        newStatus: saved.status,
      });
    }
    return saved;
  }

  async dispute(id: string, actorId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let oldStatus: OrderStatus;
    let serviceId: string | undefined;
    let saved: Order;

    try {
      const order = await queryRunner.manager.findOne(Order, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');

      OrderRolePolicy.ensureConsumerAction(order, actorId, 'dispute');
      OrderStatusTransitionPolicy.ensureDisputable(order.status);

      oldStatus = order.status;
      serviceId = order.service_id ?? undefined;
      order.status = OrderStatus.DISPUTED;
      saved = await queryRunner.manager.save(Order, order);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (saved) {
      this.notifyStatusChange({
        orderId: id,
        serviceId,
        oldStatus,
        newStatus: saved.status,
      });
    }
    return saved;
  }

  async cancel(id: string, actorId: string, reason?: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = await queryRunner.manager.findOne(Order, {
        where: { id },
        relations: ['service'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Order not found');

      const cancelledRole = OrderRolePolicy.resolveCancellationActorRole(
        order,
        actorId,
      );
      OrderStatusTransitionPolicy.ensureCancellable(order.status);

      const { penaltyAmount, refundAmount, shouldSettleFrozenCredit } =
        OrderCancellationSettlementPolicy.compute({
          actorRole: cancelledRole,
          status: order.status,
          frozenPoints: order.frozen_points,
          startTime: order.start_time,
          cancellationPolicy: order.service?.cancellation_policy,
        });

      if (shouldSettleFrozenCredit) {
        if (penaltyAmount > 0) {
          await this.orderFinancialService.transferFrozenPenalty(
            order.consumer_id,
            order.owner_id,
            penaltyAmount,
            queryRunner.manager,
          );
        }

        if (refundAmount > 0) {
          await this.orderFinancialService.unfreezeDepositCredit(
            order.consumer_id,
            refundAmount,
            queryRunner.manager,
          );
        }
      }

      order.metadata = {
        ...(order.metadata || {}),
        cancelled_by: actorId,
        cancelled_at: new Date(),
        cancellation_reason: reason || 'No reason provided',
        cancelled_role: cancelledRole,
        penalty_amount: penaltyAmount,
        refund_amount: refundAmount,
      };

      const oldStatus = order.status;
      const serviceId = order.service_id ?? undefined;
      order.status = OrderStatus.CANCELLED;

      const saved = await queryRunner.manager.save(Order, order);
      await queryRunner.commitTransaction();

      this.notifyStatusChange({
        orderId: id,
        serviceId,
        oldStatus,
        newStatus: saved.status,
      });

      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private notifyStatusChange(params: {
    orderId: string;
    serviceId?: string;
    oldStatus: OrderStatus;
    newStatus: OrderStatus;
  }) {
    this.orderStatusNotifierService.notifyStatusChange(params);
  }
}
