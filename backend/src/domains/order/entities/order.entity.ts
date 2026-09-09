import {
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
import { Exclude } from 'class-transformer';

export enum OrderStatus {
  PENDING = 'PENDING',
  RESERVED = 'RESERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FORFEITED = 'FORFEITED',
  DISPUTED = 'DISPUTED',
}

@Entity('orders')
@Check('chk_order_time_range', 'end_time > start_time')
@Check('chk_order_frozen_points_nonnegative', 'frozen_points >= 0')
@Check('chk_order_price_nonnegative', 'display_price_snapshot >= 0')
@Index('idx_orders_consumer', ['consumer_id'])
@Index('idx_orders_service', ['service_id']) // Renamed index
@Index('idx_orders_conflict_lookup', [
  'service_id',
  'start_time',
  'end_time',
  'status',
])
@Index('idx_orders_time_range', ['service_id', 'start_time', 'end_time'], {
  where: "status NOT IN ('CANCELLED', 'FORFEITED')",
})
@Index('idx_orders_provider_conflict', [
  'owner_id',
  'start_time',
  'end_time',
  'status',
])
@Index('idx_orders_owner_created_at', ['owner_id', 'created_at'])
@Index('idx_orders_owner_start_time', ['owner_id', 'start_time'])
@Index('uq_orders_source_idempotency_key', ['source_idempotency_key'], {
  unique: true,
  where: 'source_idempotency_key IS NOT NULL',
})
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  order_no: string;

  @Column({ type: 'varchar', length: 191, nullable: true })
  @Exclude()
  source_idempotency_key: string | null;

  @Column()
  consumer_id: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'consumer_id' })
  consumer: any;

  // New owner_id column for global conflict check
  @Index()
  @Column()
  owner_id: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id' })
  owner: any;

  @Column({ type: 'uuid', nullable: true })
  service_id: string | null;

  @ManyToOne('Service', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_id' })
  service: any;

  // Snapshot of service details at the time of order creation
  @Column('simple-json', { nullable: true })
  service_snapshot: {
    title: string;
    description?: string;
    duration_minutes: number;
    base_price: number;
    provider_base_price?: number;
    cost_price?: number;
    sale_price?: number;
    owner_name?: string;
  };

  @Column({ type: 'uuid', nullable: true })
  agency_node_id: string | null;

  @ManyToOne('AgencyNode', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agency_node_id' })
  agency_node: any;

  @Column()
  start_time: Date;

  @Column()
  end_time: Date;

  @Column({
    type: 'simple-enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  frozen_points: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  display_price_snapshot: number;

  @Column('simple-json', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
