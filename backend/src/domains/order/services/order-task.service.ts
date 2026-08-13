import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderFinancialService } from './order-financial.service';

@Injectable()
export class OrderTaskService {
  private readonly logger = new Logger(OrderTaskService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly orderFinancialService: OrderFinancialService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoCompletion(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.status = :status', { status: OrderStatus.RESERVED })
      .andWhere('order.end_time < :cutoff', { cutoff })
      .leftJoinAndSelect('order.service', 'service')
      .getMany();

    this.logger.log(
      `[AutoCompletion] Found ${orders.length} orders to complete.`,
    );

    for (const order of orders) {
      try {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          const lockedOrder = await queryRunner.manager.findOne(Order, {
            where: { id: order.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!lockedOrder || lockedOrder.status !== OrderStatus.RESERVED) {
            await queryRunner.commitTransaction();
            continue;
          }

          await this.orderFinancialService.unfreezeDepositCredit(
            lockedOrder.consumer_id,
            lockedOrder.frozen_points,
            queryRunner.manager,
          );

          lockedOrder.status = OrderStatus.COMPLETED;
          lockedOrder.metadata = {
            ...(lockedOrder.metadata || {}),
            completed_by: 'SYSTEM',
            completed_at: new Date(),
            completed_role: 'SYSTEM',
            auto_completed: true,
          };

          await queryRunner.manager.save(Order, lockedOrder);
          await queryRunner.commitTransaction();
          this.logger.log(
            `[AutoCompletion] Order ${lockedOrder.id} completed.`,
          );
        } catch (e: unknown) {
          const error = e instanceof Error ? e : new Error(String(e));
          this.logger.error(
            `[AutoCompletion] Failed to complete order ${order.id}`,
            error.stack,
          );
          await queryRunner.rollbackTransaction();
        } finally {
          await queryRunner.release();
        }
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.logger.error(
          `[AutoCompletion] Error processing order ${order.id}`,
          error.stack,
        );
      }
    }
  }
}
