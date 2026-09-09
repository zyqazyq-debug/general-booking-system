import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  ORDER_NOTIFICATION_PENDING,
  ORDER_NOTIFICATION_SENDING,
  ORDER_NOTIFICATION_SENT,
  ORDER_NOTIFICATION_UNCERTAIN,
  OrderNotificationDelivery,
} from './order-notification-delivery.entity';

const SEND_LEASE_MS = 120_000;

export class OrderNotificationDeliveryUncertainError extends Error {
  constructor() {
    super('Order notification delivery outcome requires reconciliation');
    this.name = OrderNotificationDeliveryUncertainError.name;
  }
}

@Injectable()
export class OrderNotificationDeliveryService {
  constructor(
    @InjectRepository(OrderNotificationDelivery)
    private readonly deliveries: Repository<OrderNotificationDelivery>,
  ) {}

  async sendOnce(
    eventId: string,
    recipientId: string,
    send: () => Promise<void>,
  ): Promise<void> {
    await this.deliveries
      .createQueryBuilder()
      .insert()
      .into(OrderNotificationDelivery)
      .values({
        id: randomUUID(),
        event_id: eventId,
        recipient_id: recipientId,
        status: ORDER_NOTIFICATION_PENDING,
        claim_token: null,
        lease_expires_at: null,
        sent_at: null,
        last_error_type: null,
      })
      .orIgnore()
      .execute();

    const token = randomUUID();
    const now = new Date();
    const claimed = await this.deliveries
      .createQueryBuilder()
      .update(OrderNotificationDelivery)
      .set({
        status: ORDER_NOTIFICATION_SENDING,
        claim_token: token,
        lease_expires_at: new Date(now.getTime() + SEND_LEASE_MS),
      })
      .where('event_id = :eventId', { eventId })
      .andWhere('recipient_id = :recipientId', { recipientId })
      .andWhere('status = :status', { status: ORDER_NOTIFICATION_PENDING })
      .execute();

    if (claimed.affected !== 1) {
      await this.handleExisting(eventId, recipientId, now);
      return;
    }

    try {
      await send();
    } catch (error) {
      await this.markUncertain(eventId, recipientId, token, error);
      throw new OrderNotificationDeliveryUncertainError();
    }

    const completed = await this.deliveries
      .createQueryBuilder()
      .update(OrderNotificationDelivery)
      .set({
        status: ORDER_NOTIFICATION_SENT,
        sent_at: new Date(),
        claim_token: null,
        lease_expires_at: null,
        last_error_type: null,
      })
      .where('event_id = :eventId', { eventId })
      .andWhere('recipient_id = :recipientId', { recipientId })
      .andWhere('status = :status', { status: ORDER_NOTIFICATION_SENDING })
      .andWhere('claim_token = :token', { token })
      .execute();
    if (completed.affected !== 1) {
      throw new OrderNotificationDeliveryUncertainError();
    }
  }

  private async handleExisting(
    eventId: string,
    recipientId: string,
    now: Date,
  ): Promise<void> {
    const existing = await this.deliveries.findOne({
      where: { event_id: eventId, recipient_id: recipientId },
    });
    if (!existing) {
      throw new ConflictException('Notification delivery claim was lost');
    }
    if (existing.status === ORDER_NOTIFICATION_SENT) return;
    if (
      existing.status === ORDER_NOTIFICATION_SENDING &&
      existing.lease_expires_at &&
      existing.lease_expires_at <= now
    ) {
      await this.deliveries
        .createQueryBuilder()
        .update(OrderNotificationDelivery)
        .set({
          status: ORDER_NOTIFICATION_UNCERTAIN,
          claim_token: null,
          lease_expires_at: null,
          last_error_type: 'SendingLeaseExpired',
        })
        .where('id = :id', { id: existing.id })
        .andWhere('status = :status', { status: ORDER_NOTIFICATION_SENDING })
        .andWhere('claim_token = :token', { token: existing.claim_token })
        .execute();
    }
    throw new OrderNotificationDeliveryUncertainError();
  }

  private async markUncertain(
    eventId: string,
    recipientId: string,
    token: string,
    error: unknown,
  ): Promise<void> {
    await this.deliveries
      .createQueryBuilder()
      .update(OrderNotificationDelivery)
      .set({
        status: ORDER_NOTIFICATION_UNCERTAIN,
        claim_token: null,
        lease_expires_at: null,
        last_error_type: error instanceof Error ? error.name : 'UnknownError',
      })
      .where('event_id = :eventId', { eventId })
      .andWhere('recipient_id = :recipientId', { recipientId })
      .andWhere('status = :status', { status: ORDER_NOTIFICATION_SENDING })
      .andWhere('claim_token = :token', { token })
      .execute();
  }
}
