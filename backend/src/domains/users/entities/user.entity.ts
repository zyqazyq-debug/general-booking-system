import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Check,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  OWNER = 'OWNER',
  AGENT = 'AGENT',
  CONSUMER = 'CONSUMER',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  MERGED = 'MERGED',
  DISABLED = 'DISABLED',
}

@Entity()
@Check('chk_user_wallet_nonnegative', 'wallet_balance >= 0')
@Check('chk_user_credit_nonnegative', 'credit_balance >= 0')
@Check('chk_user_frozen_nonnegative', 'frozen_credit >= 0')
@Check('chk_user_risk_score_range', 'risk_score >= 0 AND risk_score <= 100')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({
    type: 'simple-enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ type: 'varchar', nullable: true })
  merged_into_id: string;

  @Exclude() // Hide password in API responses
  @Column({ type: 'varchar', nullable: true })
  password: string;

  @Exclude() // Hide email by default for privacy
  @Column({ type: 'varchar', nullable: true, unique: true })
  email: string | null;

  @Exclude() // Hide wallet balance
  @Column('decimal', {
    precision: 10,
    scale: 4,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  wallet_balance: number;

  @Exclude() // Hide credit balance
  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  credit_balance: number;

  @Exclude() // Hide frozen credit
  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  frozen_credit: number;

  @Column({ type: 'varchar', nullable: true, default: 'zh-CN' })
  locale: string;

  @Column({
    type: 'simple-array',
    default: 'CONSUMER',
  })
  roles: string[];

  @Exclude() // Hide referrer_id
  @Index()
  @Column({ type: 'varchar', nullable: true })
  referrer_id: string | null;

  @Column({ type: 'varchar', nullable: true, unique: true, length: 7 })
  referral_code: string | null;

  @Exclude() // Hide WeChat ID
  @Column({ type: 'varchar', nullable: true, unique: true })
  wechat_openid: string | null;

  @Exclude() // Hide QQ ID
  @Column({ type: 'varchar', nullable: true, unique: true })
  qq_openid: string | null;

  @Exclude() // Hide Phone
  @Column({ type: 'varchar', nullable: true, unique: true })
  phone: string | null;

  @Exclude() // Hide Telegram ID
  @Column({ type: 'varchar', nullable: true, unique: true })
  telegram_chat_id: string | null;

  @Exclude() // Hide Telegram Username
  @Column({ type: 'varchar', nullable: true })
  telegram_username: string | null;

  @Column({ type: 'varchar', nullable: true })
  nickname: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Exclude() // Hide Risk Score
  @Column({ default: 100 })
  risk_score: number;

  @Column({ default: false })
  is_verified: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn({ select: false }) // Soft delete, hidden by default
  deleted_at: Date;
}
