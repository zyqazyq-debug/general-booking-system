﻿﻿﻿﻿﻿import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../../users';

@Entity('collection_quota_bills')
@Check('chk_collection_quota_bill_extra_positive', 'extra_slots > 0')
@Check('chk_collection_quota_bill_months_positive', 'months > 0')
@Check('chk_collection_quota_bill_amount_positive', 'amount > 0')
export class CollectionQuotaBill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  order_no: string;

  @Index()
  @Column()
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('int')
  extra_slots: number;

  @Column('int', { default: 1 })
  months: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({ default: 'PENDING' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  channel: string | null;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  period_start: Date;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  period_end: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  paid_at: Date | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
