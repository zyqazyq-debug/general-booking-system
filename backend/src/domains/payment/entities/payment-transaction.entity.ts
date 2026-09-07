import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { ColumnType } from 'typeorm';
import { User } from '../../users';
import { PaymentChannel, PaymentTransactionStatus } from '../payment.types';

const metadataColumnType: ColumnType =
  process.env.NODE_ENV === 'test' || process.env.USE_POSTGRES === 'false'
    ? 'simple-json'
    : 'jsonb';

@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ unique: true })
  @Index()
  order_no: string; // Internal order number for this transaction

  @Column({ nullable: true })
  @Index('UQ_payment_transactions_trade_no', {
    unique: true,
    where: '"trade_no" IS NOT NULL',
  })
  trade_no?: string; // External transaction ID from payment provider

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'uuid', nullable: true })
  @Index('UQ_payment_transactions_payment_event_id', {
    unique: true,
    where: '"payment_event_id" IS NOT NULL',
  })
  payment_event_id?: string;

  @Column({ type: 'simple-enum', enum: PaymentChannel })
  channel: PaymentChannel;

  @Column({
    type: 'simple-enum',
    enum: PaymentTransactionStatus,
    default: PaymentTransactionStatus.PENDING,
  })
  status: PaymentTransactionStatus;

  @Column({ type: metadataColumnType, nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
