import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import type { CreateOrderCommand } from '../dto/create-order.dto';
import { ORDER_SERVICES_PORT } from '../ports/tokens';
import type { OrderServicesPort } from '../ports/order-services.port';
import { OrderValidator } from '../utils/order-validator';
import { OrderFinancialService } from './order-financial.service';
import { OrderSourceResolverService } from './order-source-resolver.service';
import type { OrderCreatedEvent } from '../events/order-created.event';
import { OrderOutboxService } from '../outbox/order-outbox.service';

@Injectable()
export class OrderCreationService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject(ORDER_SERVICES_PORT)
    private readonly servicesPort: OrderServicesPort,
    private readonly orderSourceResolverService: OrderSourceResolverService,
    private readonly dataSource: DataSource,
    private readonly orderOutbox: OrderOutboxService,
    private readonly orderFinancialService: OrderFinancialService,
  ) {}

  async create(createOrderDto: CreateOrderCommand): Promise<Order> {
    const sourceIdempotencyKey = this.normalizeSourceIdempotencyKey(
      createOrderDto.source_idempotency_key,
    );
    if (sourceIdempotencyKey) {
      const existing = await this.orderRepository.findOne({
        where: { source_idempotency_key: sourceIdempotencyKey },
      });
      if (existing) {
        this.assertIdempotencyReplayMatches(existing, createOrderDto);
        await this.orderOutbox.dispatchOrderCreatedBestEffort(existing.id);
        return existing;
      }
    }

    const service = await this.servicesPort.findServiceById(
      createOrderDto.service_id,
    );
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    const servicePrice = service;

    const sourceResolved = await this.orderSourceResolverService.resolve({
      serviceId: service.id,
      basePrice: Number(
        servicePrice.provider_base_price ??
          service.base_price ??
          servicePrice.base_price ??
          0,
      ),
      agencyNodeId: createOrderDto.agency_node_id,
    });
    const displayPrice = sourceResolved.displayPrice;
    const agencyNodeId = sourceResolved.agencyNodeId;

    const consumerId = createOrderDto.consumer_id as string;
    const startTime = new Date(createOrderDto.start_time);
    const endTime = new Date(createOrderDto.end_time);
    OrderValidator.validateSchedule(service, startTime, endTime);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let newlyCreatedOrder!: Order;

    try {
      const isPostgres = this.dataSource.options.type === 'postgres';
      const isSqlite = this.dataSource.options.type === 'sqlite';

      if (sourceIdempotencyKey) {
        if (isPostgres) {
          await queryRunner.query(
            `SELECT pg_advisory_xact_lock(hashtext($1))`,
            [`order_idempotency:${sourceIdempotencyKey}`],
          );
        }

        const existing = await queryRunner.manager.findOne(Order, {
          where: { source_idempotency_key: sourceIdempotencyKey },
        });
        if (existing) {
          this.assertIdempotencyReplayMatches(existing, createOrderDto);
          await queryRunner.commitTransaction();
          await this.orderOutbox.dispatchOrderCreatedBestEffort(existing.id);
          return existing;
        }
      }

      if (isPostgres) {
        const lockKeys = this.buildProviderDateBucketKeys(
          service.owner_id,
          startTime,
          endTime,
        );
        for (const key of lockKeys) {
          await queryRunner.query(
            `SELECT pg_advisory_xact_lock(hashtext($1))`,
            [key],
          );
        }
      } else if (!isSqlite) {
        await queryRunner.manager.findOne('User', {
          where: { id: service.owner_id },
          lock: { mode: 'pessimistic_write' },
        });
      }

      await OrderValidator.checkTimeSlotAvailability(
        queryRunner.manager,
        service.id,
        startTime,
        endTime,
      );

      const depositPoints = Number(service.deposit_points ?? 0);
      await this.orderFinancialService.freezeDepositCredit(
        consumerId,
        depositPoints,
        queryRunner.manager,
      );

      const orderNo = await this.generateOrderNo(queryRunner.manager);
      const orderDraft: DeepPartial<Order> = {
        order_no: orderNo,
        source_idempotency_key: sourceIdempotencyKey,
        consumer_id: consumerId,
        service_id: service.id,
        owner_id: service.owner_id,
        agency_node_id: agencyNodeId,
        start_time: startTime,
        end_time: endTime,
        frozen_points: depositPoints,
        display_price_snapshot: displayPrice,
        status: OrderStatus.RESERVED,
        service_snapshot: {
          title: service.title ?? undefined,
          description: service.description ?? undefined,
          duration_minutes: service.duration_minutes,
          base_price: Number(service.base_price ?? 0),
          provider_base_price: Number(
            service.provider_base_price ?? service.base_price ?? 0,
          ),
          cost_price: Number(service.cost_price ?? 0),
          sale_price: Number(displayPrice),
        },
      };
      const order = this.orderRepository.create(orderDraft);

      const savedOrder = await queryRunner.manager.save(Order, order);
      await this.orderOutbox.enqueueOrderCreated(
        queryRunner.manager,
        this.buildCreatedEvent(savedOrder),
      );
      await queryRunner.commitTransaction();
      newlyCreatedOrder = savedOrder;
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      if (sourceIdempotencyKey) {
        const existing = await this.orderRepository.findOne({
          where: { source_idempotency_key: sourceIdempotencyKey },
        });
        if (existing) {
          this.assertIdempotencyReplayMatches(existing, createOrderDto);
          await this.orderOutbox.dispatchOrderCreatedBestEffort(existing.id);
          return existing;
        }
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    await this.orderOutbox.dispatchOrderCreatedBestEffort(newlyCreatedOrder.id);
    return newlyCreatedOrder;
  }

  private buildCreatedEvent(savedOrder: Order): OrderCreatedEvent {
    return {
      orderId: savedOrder.id,
      orderNo: savedOrder.order_no,
      serviceId: savedOrder.service_id,
      agencyNodeId: savedOrder.agency_node_id,
      customerId: savedOrder.consumer_id,
      providerId: savedOrder.owner_id,
      priceSnapshot: {
        basePrice: Number(savedOrder.service_snapshot?.base_price ?? 0),
        displayPrice: Number(savedOrder.display_price_snapshot ?? 0),
      },
    };
  }

  private normalizeSourceIdempotencyKey(value?: string): string | null {
    if (value === undefined) return null;
    if (value.length === 0 || value !== value.trim() || value.length > 191) {
      throw new BadRequestException('Invalid source idempotency key');
    }
    return value;
  }

  private assertIdempotencyReplayMatches(
    existing: Order,
    command: CreateOrderCommand,
  ): void {
    const sameFingerprint =
      existing.consumer_id === command.consumer_id &&
      existing.service_id === command.service_id &&
      (existing.agency_node_id ?? null) === (command.agency_node_id ?? null) &&
      existing.start_time.getTime() ===
        new Date(command.start_time).getTime() &&
      existing.end_time.getTime() === new Date(command.end_time).getTime();

    if (!sameFingerprint) {
      throw new ConflictException(
        'Source idempotency key was already used for a different order request',
      );
    }
  }

  private async generateOrderNo(manager: EntityManager): Promise<string> {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nanoid = (size: number) => {
      let s = '';
      for (let i = 0; i < size; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return s;
    };
    for (;;) {
      const ts = new Date();
      const y = ts.getFullYear();
      const m = String(ts.getMonth() + 1).padStart(2, '0');
      const d = String(ts.getDate()).padStart(2, '0');
      const hh = String(ts.getHours()).padStart(2, '0');
      const mm = String(ts.getMinutes()).padStart(2, '0');
      const ss = String(ts.getSeconds()).padStart(2, '0');
      const candidate = `O${y}${m}${d}${hh}${mm}${ss}${nanoid(4)}`;
      const exists = await manager.findOne(Order, {
        where: { order_no: candidate },
      });
      if (!exists) return candidate;
    }
  }

  private buildProviderDateBucketKeys(
    ownerId: string,
    startTime: Date,
    endTime: Date,
  ): string[] {
    const startDay = startTime.toISOString().slice(0, 10);
    const endDay = endTime.toISOString().slice(0, 10);
    const keys = new Set<string>();
    keys.add(`order_lock:${ownerId}:${startDay}`);
    keys.add(`order_lock:${ownerId}:${endDay}`);
    return Array.from(keys).sort();
  }
}
