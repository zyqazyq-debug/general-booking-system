import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const TELEGRAM_WEBHOOK_UPDATE_PROCESSING = 'processing';
export const TELEGRAM_WEBHOOK_UPDATE_PROCESSED = 'processed';

@Entity('telegram_webhook_updates')
@Index('IDX_telegram_webhook_updates_processing_lease', [
  'status',
  'lease_expires_at',
])
export class TelegramWebhookUpdate {
  @PrimaryColumn({ type: 'bigint' })
  update_id: string;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'varchar', length: 36 })
  claim_token: string;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  lease_expires_at: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  processed_at: Date | null;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  received_at: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  updated_at: Date;
}
