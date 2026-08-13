﻿﻿﻿﻿﻿import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from '../../users';

type AgencyNodeServiceSnapshot = {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
  is_deleted: boolean;
  base_price: number | string;
  provider_base_price?: number | string;
  cost_price?: number;
  sale_price?: number;
  deposit_points?: number | string;
  buffer_minutes?: number | string;
  rules?: unknown;
};

@Entity('agency_nodes')
@Check('chk_agency_markup_nonnegative', 'markup_amount >= 0')
@Index('idx_agency_parent', ['parent_node_id'])
@Index('idx_agency_service', ['service_id'])
@Index('idx_agency_agent', ['agent_id'])
export class AgencyNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: 'STANDARD' })
  node_type: 'STANDARD' | 'CONTRACT';

  @Column({ type: 'uuid', nullable: true })
  parent_node_id: string | null;

  @ManyToOne(() => AgencyNode, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_node_id' })
  parent_node: AgencyNode | null;

  @Column()
  service_id: string;

  @ManyToOne('Service', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_id' })
  service: AgencyNodeServiceSnapshot;

  @Column()
  agent_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id' })
  agent: User;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  markup_amount: number;

  // Redundant fields for performance optimization (Write-Time Calculation)

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  cache_cost_price: number; // Cost Price (Parent's Total Price or Service Base Price)

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  cache_total_price: number; // Final Price (Cost + Markup)

  @Column({ default: 'PERCENT' })
  markup_type: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  markup_value: number; // The raw value (e.g. 20 for 20% or 20 for ¥20)

  @Column({ nullable: true })
  alias: string;

  @Column({ nullable: true, type: 'varchar' })
  inherited_name: string | null; // The display name inherited from parent (Snapshot of parent's alias or inherited_name at time of import)

  @Column({ type: 'text', nullable: true })
  private_notes: string;

  @Column({ type: 'text', nullable: true })
  public_notes: string;

  @Column({ type: 'text', nullable: true })
  compliance_content: string | null;

  @Column({ type: 'varchar', nullable: true })
  compliance_signature: string | null;

  @Column({ unique: true })
  share_slug: string;

  @Column({ default: 'ACTIVE' })
  status: string; // ACTIVE, SUSPENDED

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
