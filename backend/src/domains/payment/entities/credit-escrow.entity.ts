import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from '../../order';

export enum EscrowStatus {
  FROZEN = 'FROZEN',
  RELEASED = 'RELEASED',
  FORFEITED = 'FORFEITED',
}

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  REFUND = 'REFUND',
  SEIZURE = 'SEIZURE',
}

@Entity('credit_escrow')
export class CreditEscrow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  order_id: string;

  @OneToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({
    type: 'simple-enum',
    enum: EscrowStatus,
    default: EscrowStatus.FROZEN,
  })
  status: EscrowStatus;

  @Column({
    type: 'simple-enum',
    enum: TransactionType,
    default: TransactionType.DEPOSIT,
  })
  transaction_type: TransactionType;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
