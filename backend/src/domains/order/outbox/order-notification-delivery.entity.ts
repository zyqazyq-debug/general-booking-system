import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const ORDER_NOTIFICATION_PENDING = 'pending';
export const ORDER_NOTIFICATION_SENDING = 'sending';
export const ORDER_NOTIFICATION_SENT = 'sent';
export const ORDER_NOTIFICATION_FAILED = 'failed';
export const ORDER_NOTIFICATION_UNCERTAIN = 'uncertain';

@Entity('order_notification_deliveries')
@Index('uq_order_notification_event_recipient', ['event_id', 'recipient_id'], {
  unique: true,
})
@Index('idx_order_notification_status_lease', ['status', 'lease_expires_at'])
export class OrderNotificationDelivery {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'uuid' })
  event_id: string;

  @Column({ type: 'varchar', length: 128 })
  recipient_id: string;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claim_token: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  lease_expires_at: Date | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  sent_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider_message_id: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  last_error_type: string | null;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  updated_at: Date;
}
