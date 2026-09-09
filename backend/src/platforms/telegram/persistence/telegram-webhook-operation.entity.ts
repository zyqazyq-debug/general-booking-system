import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('telegram_webhook_operations')
@Index('IDX_telegram_webhook_operations_update', ['update_id'])
export class TelegramWebhookOperation {
  @PrimaryColumn({ type: 'varchar', length: 200 })
  idempotency_key: string;

  @Column({ type: 'bigint' })
  update_id: string;

  @Column({ type: 'varchar', length: 80 })
  operation: string;

  @Column({ type: 'varchar', length: 64 })
  resource_hash: string;

  @Column({ type: 'varchar', length: 16 })
  status: 'started' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  result_payload: string | null;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  updated_at: Date;
}
