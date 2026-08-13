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
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { User } from '../../users';
import { ResourceTemplate } from '../../resources';

@Entity('services')
@Check('chk_service_base_price_nonnegative', 'base_price >= 0')
@Check('chk_service_deposit_nonnegative', 'deposit_points >= 0')
@Check('chk_service_duration_positive', 'duration_minutes > 0')
@Check('chk_service_buffer_nonnegative', 'buffer_minutes >= 0')
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  owner_id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Index()
  @Column({ nullable: true })
  resource_template_id: string; // Renamed from service_id

  @ManyToOne(() => ResourceTemplate, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'resource_template_id' })
  resource_template: ResourceTemplate;

  @Column()
  title: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  base_price: number;

  @Column('int', { default: 0 })
  deposit_points: number;

  @Column('int', { default: 60 })
  duration_minutes: number;

  @Column('int', { default: 0 })
  buffer_minutes: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: false })
  is_deleted: boolean;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  original_notes: string;

  // 鏍稿績瑙勫垯瀛樺偍
  @Column('simple-json', { nullable: true })
  rules: {
    weekdays?: Array<number | string>;
    start_hour?: number | string;
    end_hour?: number | string;
    [key: string]: unknown;
  } | null;

  @Column('simple-json', { nullable: true })
  cancellation_policy: {
    type: 'flexible' | 'moderate' | 'strict' | 'custom';
    window_minutes: number;
    penalty_percent: number;
  } | null;

  // 鍐椾綑绱㈠紩瀛楁 (Generated Columns)
  // 娉ㄦ剰锛歍ypeORM 鐩墠瀵?Generated Columns 鐨勬敮鎸佹湁闄愶紝閫氬父浣滀负鏅€?Column 瀹氫箟锛?  // 浣嗗湪鏁版嵁搴撹縼绉讳腑鎴戜滑宸茬粡鎵嬪姩娣诲姞浜嗚繖浜涘垪銆?  // 涓轰簡璁?TypeORM 鑳借鍐欏畠浠紙鎴栬€呰嚦灏戣鍙栵級锛屾垜浠渶瑕佸畾涔夊畠浠€?  // 濡傛灉鏄?Generated Column锛岄€氬父璁句负 readonly 鎴?insert: false, update: false

  @Index('idx_services_weekdays', { synchronize: false }) // 鍛婅瘔 TypeORM 涓嶈灏濊瘯鍚屾杩欎釜澶嶆潅鐨?GIN 绱㈠紩
  @Column('int', { array: true, nullable: true })
  index_weekdays: number[] | null;

  @Index('idx_services_start_hour')
  @Column('int', { nullable: true })
  index_start_hour: number | null;

  @Index('idx_services_end_hour')
  @Column('int', { nullable: true })
  index_end_hour: number | null;

  @BeforeInsert()
  @BeforeUpdate()
  syncIndexFields() {
    if (this.rules) {
      const weekdays = this.rules.weekdays;
      this.index_weekdays = Array.isArray(weekdays)
        ? weekdays.map((d) => Number(d))
        : null;
      const startHour = this.rules.start_hour;
      this.index_start_hour =
        startHour === undefined || startHour === null
          ? null
          : Number(startHour);
      const endHour = this.rules.end_hour;
      this.index_end_hour =
        endHour === undefined || endHour === null ? null : Number(endHour);
    }
  }

  @Column('simple-json', { nullable: true })
  location: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };

  @Column('simple-json', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // 铏氭嫙瀛楁锛岀敤浜庝笟鍔″搷搴斾腑鐨勪环鏍煎睍绀?  provider_base_price?: number;
  cost_price?: number;
  sale_price?: number;
}
