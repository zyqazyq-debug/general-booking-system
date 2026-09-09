import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Brackets, EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import type { OrderCreatedEvent } from '../events/order-created.event';
import {
  ORDER_CREATED_EVENT_TYPE,
  ORDER_OUTBOX_PENDING,
  ORDER_OUTBOX_PROCESSED,
  ORDER_OUTBOX_PROCESSING,
  OrderOutboxEvent,
} from './order-outbox-event.entity';

const LEASE_MS = 60_000;
const POLL_MS = 5_000;
const BATCH_SIZE = 25;

@Injectable()
export class OrderOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderOutboxService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectRepository(OrderOutboxEvent)
    private readonly events: Repository<OrderOutboxEvent>,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.isDispatchEnabled()) {
      this.logger.warn(
        'Order outbox dispatcher is disabled; events will remain durable and pending.',
      );
      return;
    }
    this.pollTimer = setInterval(() => void this.drain(), POLL_MS);
    this.pollTimer.unref?.();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async enqueueOrderCreated(
    manager: EntityManager,
    payload: Omit<OrderCreatedEvent, 'eventId'>,
  ): Promise<OrderOutboxEvent> {
    const id = randomUUID();
    const event = manager.create(OrderOutboxEvent, {
      id,
      aggregate_id: payload.orderId,
      event_type: ORDER_CREATED_EVENT_TYPE,
      idempotency_key: `${ORDER_CREATED_EVENT_TYPE}:${payload.orderId}`,
      payload: { ...payload, eventId: id },
      status: ORDER_OUTBOX_PENDING,
      attempts: 0,
      claim_token: null,
      lease_expires_at: null,
      available_at: new Date(),
      processed_at: null,
      last_error: null,
    });
    return manager.save(OrderOutboxEvent, event);
  }

  async dispatchOrderCreatedBestEffort(orderId: string): Promise<void> {
    if (!this.isDispatchEnabled()) return;
    try {
      const event = await this.events.findOne({
        where: {
          idempotency_key: `${ORDER_CREATED_EVENT_TYPE}:${orderId}`,
        },
      });
      if (event) await this.dispatchById(event.id);
    } catch (error) {
      this.logger.warn(
        `Order outbox dispatch deferred for aggregate ${orderId}: ${this.errorType(error)}`,
      );
    }
  }

  async dispatchById(id: string): Promise<boolean> {
    if (!this.isDispatchEnabled()) return false;
    const claimed = await this.claim(id);
    if (!claimed) return false;

    try {
      await this.runWhileRenewingLease(claimed, async () => {
        await this.eventEmitter.emitAsync(claimed.event_type, claimed.payload);
      });
      const completed = await this.events
        .createQueryBuilder()
        .update(OrderOutboxEvent)
        .set({
          status: ORDER_OUTBOX_PROCESSED,
          processed_at: new Date(),
          claim_token: null,
          lease_expires_at: null,
          last_error: null,
        })
        .where('id = :id', { id: claimed.id })
        .andWhere('status = :status', { status: ORDER_OUTBOX_PROCESSING })
        .andWhere('claim_token = :token', { token: claimed.claim_token })
        .execute();
      return completed.affected === 1;
    } catch (error) {
      await this.requeue(claimed, error);
      throw error;
    }
  }

  async getOrderCreatedOutbox(
    orderId: string,
  ): Promise<OrderOutboxEvent | null> {
    return this.events.findOne({
      where: { idempotency_key: `${ORDER_CREATED_EVENT_TYPE}:${orderId}` },
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      const pending = await this.events.find({
        select: { id: true },
        where: [
          { status: ORDER_OUTBOX_PENDING, available_at: LessThanOrEqual(now) },
          {
            status: ORDER_OUTBOX_PROCESSING,
            lease_expires_at: LessThanOrEqual(now),
          },
        ],
        order: { created_at: 'ASC' },
        take: BATCH_SIZE,
      });
      await Promise.allSettled(
        pending.map((event) => this.dispatchById(event.id)),
      );
    } catch (error) {
      this.logger.warn(`Order outbox drain deferred: ${this.errorType(error)}`);
    } finally {
      this.draining = false;
    }
  }

  private async claim(id: string): Promise<OrderOutboxEvent | null> {
    const now = new Date();
    const token = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.events
      .createQueryBuilder()
      .update(OrderOutboxEvent)
      .set({
        status: ORDER_OUTBOX_PROCESSING,
        claim_token: token,
        lease_expires_at: leaseExpiresAt,
        attempts: () => '"attempts" + 1',
      })
      .where('id = :id', { id })
      .andWhere(
        new Brackets((query) => {
          query
            .where('(status = :pending AND available_at <= :now)', {
              pending: ORDER_OUTBOX_PENDING,
              now,
            })
            .orWhere('(status = :processing AND lease_expires_at <= :now)', {
              processing: ORDER_OUTBOX_PROCESSING,
              now,
            });
        }),
      )
      .execute();
    if (claimed.affected !== 1) return null;
    return this.events.findOne({
      where: { id, status: ORDER_OUTBOX_PROCESSING, claim_token: token },
    });
  }

  private async runWhileRenewingLease<T>(
    event: OrderOutboxEvent,
    work: () => Promise<T>,
  ): Promise<T> {
    let renewalError: unknown;
    const timer = setInterval(
      () => {
        void this.renew(event.id, event.claim_token as string).catch(
          (error) => {
            renewalError = error;
          },
        );
      },
      Math.floor(LEASE_MS / 3),
    );
    timer.unref?.();
    try {
      const result = await work();
      if (renewalError) throw renewalError;
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private async renew(id: string, token: string): Promise<void> {
    const renewed = await this.events
      .createQueryBuilder()
      .update(OrderOutboxEvent)
      .set({ lease_expires_at: new Date(Date.now() + LEASE_MS) })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: ORDER_OUTBOX_PROCESSING })
      .andWhere('claim_token = :token', { token })
      .execute();
    if (renewed.affected !== 1) {
      throw new Error('Order outbox lease ownership was lost');
    }
  }

  private async requeue(
    event: OrderOutboxEvent,
    error: unknown,
  ): Promise<void> {
    const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(event.attempts, 8));
    await this.events
      .createQueryBuilder()
      .update(OrderOutboxEvent)
      .set({
        status: ORDER_OUTBOX_PENDING,
        available_at: new Date(Date.now() + delayMs),
        claim_token: null,
        lease_expires_at: null,
        last_error: this.errorType(error),
      })
      .where('id = :id', { id: event.id })
      .andWhere('status = :status', { status: ORDER_OUTBOX_PROCESSING })
      .andWhere('claim_token = :token', { token: event.claim_token })
      .execute();
  }

  private isDispatchEnabled(): boolean {
    return (
      this.configService.get<string>('BOOKING_WORKERS_ENABLED') === 'true' &&
      this.configService.get<string>('ORDER_OUTBOX_DISPATCH_ENABLED') === 'true'
    );
  }

  private errorType(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
  }
}
