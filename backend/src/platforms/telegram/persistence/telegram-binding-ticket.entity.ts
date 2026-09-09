import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('telegram_binding_tickets')
export class TelegramBindingTicket {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ type: 'varchar', length: 16 })
  kind: 'login' | 'binding';

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: 'pending' | 'success' | 'expired';

  @Column({ type: 'text', nullable: true })
  result_payload: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  expires_at: Date;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  updated_at: Date;
}
