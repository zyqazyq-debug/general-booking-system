import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { OrderCreatedEvent } from '../events/order-created.event';

export const ORDER_OUTBOX_PENDING = 'pending';
export const ORDER_OUTBOX_PROCESSING = 'processing';
export const ORDER_OUTBOX_PROCESSED = 'processed';
export const ORDER_CREATED_EVENT_TYPE = 'order.created';

@Entity('order_outbox_events')
@Index('idx_order_outbox_dispatch', ['status', 'available_at'])
@Index('idx_order_outbox_processing_lease', ['status', 'lease_expires_at'])
export class OrderOutboxEvent {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid' })
  aggregate_id: string;

  @Column({ type: 'varchar', length: 64 })
  event_type: string;

  @Column({ type: 'varchar', length: 191, unique: true })
  idempotency_key: string;

  @Column({ type: 'simple-json' })
  payload: OrderCreatedEvent;

  @Column({ type: 'varchar', length: 16, default: ORDER_OUTBOX_PENDING })
  status: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claim_token: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  lease_expires_at: Date | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  available_at: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  processed_at: Date | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  last_error: string | null;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  updated_at: Date;
}
