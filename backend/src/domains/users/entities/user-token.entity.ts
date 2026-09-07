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
import { User } from './user.entity';

@Entity('user_tokens')
@Index(['expires_at']) // For cleanup jobs
export class UserToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', unique: true })
  session_id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token_hash: string;

  @Column()
  expires_at: Date;

  @Column({ type: 'simple-json', nullable: true })
  device_info: any;

  @Column({ nullable: true })
  last_active_at: Date;

  @Column({ nullable: true })
  revoked_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
