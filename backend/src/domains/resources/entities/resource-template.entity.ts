import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PhysicalResource } from './physical-resource.entity';

@Entity('resource_templates')
export class ResourceTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  resource_id: string;

  @ManyToOne(() => PhysicalResource)
  @JoinColumn({ name: 'resource_id' })
  resource: PhysicalResource;

  @Column()
  service_name: string; // e.g. "Math Tutoring 1-on-1"

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  deposit_amount: number; // Credit balance required

  @Column({ type: 'text', nullable: true })
  original_notes: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
