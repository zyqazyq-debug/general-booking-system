import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('consumed_identity_proofs')
@Index(['expires_at'])
export class ConsumedIdentityProof {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  proof_hash: string;

  @Column({ type: 'varchar', length: 16 })
  provider: string;

  @Column({ type: 'varchar', length: 64 })
  subject_hash: string;

  @Column({ type: 'uuid', nullable: true })
  actor_id: string | null;

  @Column()
  expires_at: Date;

  @CreateDateColumn()
  consumed_at: Date;
}
