﻿﻿﻿﻿﻿import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { User } from '../../users';

@Entity('product_listings')
@Check('chk_product_listing_price_nonnegative', 'added_price >= 0')
@Index('idx_product_listings_owner', ['owner_id'])
@Index('idx_product_listings_source', ['source_id'])
@Index('idx_product_listings_parent', ['parent_id'])
export class ProductListing {
  @PrimaryGeneratedColumn('increment')
  listing_id: number;

  @Column({ type: 'integer', nullable: true })
  parent_id: number | null; // Parent Listing ID

  @Column()
  source_id: string; // Original Physical Resource ID (UUID)

  @Column()
  owner_id: string; // Current Agent/Owner User ID

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  added_price: number;

  @Column({ type: 'text', nullable: true })
  display_title: string;

  @Column({ type: 'text', nullable: true })
  internal_note: string;

  @Column({ nullable: true })
  path: string; // e.g. "root/123/456"

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
