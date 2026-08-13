﻿﻿﻿﻿﻿import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users';

type CommissionOrderRef = {
  id: string;
};

@Entity('commission_records')
@Index('idx_commissions_agent_created', ['agent_id', 'created_at'])
@Index('idx_commissions_order_agent', ['order_id', 'agent_id'])
@Index('idx_commissions_order_level', ['order_id', 'level'])
export class CommissionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  order_id: string;

  @ManyToOne('Order', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: CommissionOrderRef;

  @Column()
  agent_id: string; // The beneficiary (Provider or Agent)

  @ManyToOne(() => User)
  @JoinColumn({ name: 'agent_id' })
  agent: User;

  @Column({
    type: 'simple-enum',
    enum: ['PROVIDER', 'AGENT'],
  })
  role: 'PROVIDER' | 'AGENT';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  cost_price: number; // The price this agent/provider "bought" or "produced" at

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  markup_amount: number; // The profit added by this level

  @Column({ nullable: true })
  snapshot_markup_type: string; // 'FIXED' or 'PERCENT'

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    nullable: true,
  })
  snapshot_markup_value: number; // The raw value used for calculation

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  final_price: number; // cost + markup

  @Column({ type: 'text', nullable: true })
  child_agent_id: string | null; // Who bought from me? (Next level agent or Consumer if null)

  @Column({ type: 'int' })
  level: number; // 0 = Root Provider, 1 = First Agent, etc.

  @CreateDateColumn()
  created_at: Date;
}
