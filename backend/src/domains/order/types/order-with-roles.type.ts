import { CommissionRecord } from '../../agency';
import { Order } from '../entities/order.entity';

export type OrderWithRoles = Order & {
  roles: ('CONSUMER' | 'PROVIDER' | 'AGENT')[];
  commission: Record<string, unknown>;
  commission_records?: CommissionRecord[];
};
