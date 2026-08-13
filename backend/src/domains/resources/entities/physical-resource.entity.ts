import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('physical_resources')
export class PhysicalResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  owner_id: string;

  @Column()
  name: string; // e.g. "Teacher Zhang", "Meeting Room 1"

  @Column({ default: 1 })
  capacity: number; // Concurrency capacity

  @Column({ default: 'UTC' })
  timezone: string;

  // Extension: Location
  // PostGIS not installed in environment, downgrading to simple columns for now
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @Column({ nullable: true })
  address_text: string;

  @Column('simple-json', { nullable: true })
  address_components: any;

  @Column({ default: false })
  is_online: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
