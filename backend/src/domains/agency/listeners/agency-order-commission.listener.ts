import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommissionRecord } from '../entities/commission-record.entity';
import { AgencyQueryService } from '../services/agency-query.service';
import type { OrderCreatedEvent } from '../../order';
import { CommissionCalculator } from '../utils/commission-calculator';

@Injectable()
export class AgencyOrderCommissionListener implements OnModuleDestroy {
  private readonly logger = new Logger(AgencyOrderCommissionListener.name);
  private readonly calculator: CommissionCalculator;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly agencyQueryService: AgencyQueryService,
    @InjectRepository(CommissionRecord)
    private readonly commissionRepository: Repository<CommissionRecord>,
  ) {
    this.calculator = new CommissionCalculator(
      {
        findById: (id: string) => this.agencyQueryService.findById(id),
      },
      commissionRepository,
    );
  }

  @OnEvent('order.created')
  async handleOrderCreated(payload: OrderCreatedEvent) {
    if (!payload.orderId) return;
    if (!payload.providerId) return;

    const task = (async () => {
      try {
        await this.calculator.calculateAndSave({
          orderId: payload.orderId,
          providerId: payload.providerId,
          basePrice: payload.priceSnapshot?.basePrice ?? 0,
          agencyNodeId: payload.agencyNodeId ?? null,
        });
        this.logger.log(`Commission processed for order: ${payload.orderNo}`);
      } catch (error: unknown) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Failed to calculate commission for order ${payload.orderId}: ${resolvedError.message}`,
          resolvedError.stack,
        );
      }
    })();

    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  async onModuleDestroy() {
    const tasks = Array.from(this.inFlight);
    await Promise.allSettled(tasks);
  }
}
