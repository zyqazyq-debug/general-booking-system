import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('agency_order_event_consumptions')
export class AgencyOrderEventConsumption {
  @PrimaryColumn({ type: 'uuid' })
  event_id: string;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
  })
  processed_at: Date;
}
