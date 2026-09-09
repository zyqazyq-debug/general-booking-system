import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CommissionRecord } from '../entities/commission-record.entity';
import { AgencyQueryService } from '../services/agency-query.service';
import type { OrderCreatedEvent } from '../../order';
import { CommissionCalculator } from '../utils/commission-calculator';
import { AgencyOrderEventConsumption } from '../entities/agency-order-event-consumption.entity';

@Injectable()
export class AgencyOrderCommissionListener implements OnModuleDestroy {
  private readonly logger = new Logger(AgencyOrderCommissionListener.name);
  private readonly calculator: CommissionCalculator;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly agencyQueryService: AgencyQueryService,
    @InjectRepository(CommissionRecord)
    private readonly commissionRepository: Repository<CommissionRecord>,
    private readonly dataSource: DataSource,
  ) {
    this.calculator = new CommissionCalculator(
      {
        findById: (id: string) =>
          this.agencyQueryService.findInternalSnapshotById(id),
      },
      commissionRepository,
    );
  }

  @OnEvent('order.created')
  async handleOrderCreated(payload: OrderCreatedEvent) {
    if (!payload.orderId) return;
    if (!payload.providerId) return;
    if (!payload.eventId) {
      throw new Error('Durable order.created eventId is required');
    }

    const task = (async () => {
      try {
        await this.dataSource.transaction(async (manager) => {
          await manager.insert(AgencyOrderEventConsumption, {
            event_id: payload.eventId,
          });
          await this.calculator.calculateAndSave(
            {
              orderId: payload.orderId,
              providerId: payload.providerId,
              basePrice: payload.priceSnapshot?.basePrice ?? 0,
              agencyNodeId: payload.agencyNodeId ?? null,
            },
            manager,
          );
        });
        this.logger.log(`Commission processed for order: ${payload.orderNo}`);
      } catch (error: unknown) {
        if (this.isUniqueViolation(error)) return;
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Failed to calculate commission for order ${payload.orderId}: ${resolvedError.name}`,
        );
        throw resolvedError;
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

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as {
      code?: string;
      errno?: number;
      constraint?: string;
      message?: string;
    };
    const identity = `${driverError.constraint ?? ''} ${driverError.message ?? ''}`;
    const isConstraintViolation =
      driverError.code === '23505' ||
      driverError.code === 'SQLITE_CONSTRAINT' ||
      driverError.errno === 19;
    return (
      isConstraintViolation &&
      identity.includes('agency_order_event_consumptions')
    );
  }
}
