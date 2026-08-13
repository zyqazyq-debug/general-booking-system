﻿﻿﻿﻿﻿import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { User } from '../../users';

export enum ReferralType {
  SOFTWARE_FEE = 'SOFTWARE_FEE',
}

export enum ReferralStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('referral_logs')
@Check('chk_referral_amount_positive', 'amount > 0')
export class ReferralLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_user_id' })
  sourceUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'source_user_id' })
  sourceUser: User;

  @Column({ name: 'beneficiary_id' })
  beneficiaryId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary: User;

  @Column('decimal', {
    precision: 10,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  base_amount: number;

  @Column('int')
  level: number;

  @Column({
    type: 'simple-enum',
    enum: ReferralType,
    default: ReferralType.SOFTWARE_FEE,
  })
  type: ReferralType;

  @Column({
    type: 'simple-enum',
    enum: ReferralStatus,
    default: ReferralStatus.PENDING,
  })
  status: ReferralStatus;

  @CreateDateColumn()
  created_at: Date;
}
