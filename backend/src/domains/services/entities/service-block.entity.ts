import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { Service } from './service.entity';

export enum ServiceBlockType {
  TIME_OFF = 'TIME_OFF',
  HOLIDAY = 'HOLIDAY',
  MAINTENANCE = 'MAINTENANCE',
}

@Entity('service_blocks')
@Check('chk_block_time_range', 'end_time > start_time')
@Index('idx_service_blocks_service', ['service_id'])
@Index('idx_service_blocks_time', ['start_time', 'end_time'])
@Index('idx_service_blocks_lookup', ['service_id', 'start_time', 'end_time'])
export class ServiceBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  service_id: string;

  @ManyToOne(() => Service, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_id' })
  service: Service;

  @Column({
    type: 'simple-enum',
    enum: ServiceBlockType,
    default: ServiceBlockType.TIME_OFF,
  })
  type: ServiceBlockType;

  @Column()
  start_time: Date;

  @Column()
  end_time: Date;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ type: 'text', nullable: true })
  description: string; // 说明 (Publicly visible)

  @Column({ type: 'text', nullable: true })
  notes: string; // 备注 (Private to provider)

  @CreateDateColumn()
  created_at: Date;
}
