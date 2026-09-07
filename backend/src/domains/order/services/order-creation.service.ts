import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order, OrderStatus } from '../entities/order.entity';
import type { CreateOrderCommand } from '../dto/create-order.dto';
import { ORDER_SERVICES_PORT } from '../ports/tokens';
import type { OrderServicesPort } from '../ports/order-services.port';
import { OrderValidator } from '../utils/order-validator';
import { OrderFinancialService } from './order-financial.service';
import { OrderSourceResolverService } from './order-source-resolver.service';
import type { OrderCreatedEvent } from '../events/order-created.event';

@Injectable()
export class OrderCreationService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject(ORDER_SERVICES_PORT)
    private readonly servicesPort: OrderServicesPort,
    private readonly orderSourceResolverService: OrderSourceResolverService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly orderFinancialService: OrderFinancialService,
  ) {}

  async create(createOrderDto: CreateOrderCommand): Promise<Order> {
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

    try {
      const isPostgres = this.dataSource.options.type === 'postgres';
      const isSqlite = this.dataSource.options.type === 'sqlite';

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
      await queryRunner.commitTransaction();
      const createdEvent: OrderCreatedEvent = {
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
      await this.eventEmitter.emitAsync('order.created', createdEvent);

      return savedOrder;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
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
