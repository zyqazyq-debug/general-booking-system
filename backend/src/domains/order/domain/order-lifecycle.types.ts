import { Order, OrderStatus } from '../entities/order.entity';

export type OrderCancellationPolicySnapshot = {
  window_minutes?: number | null;
  penalty_percent?: number | null;
} | null;

export type OrderLifecycleServiceSnapshot = {
  owner_id?: string | null;
  cancellation_policy?: OrderCancellationPolicySnapshot;
} | null;

export type OrderLifecycleActorRole = 'CONSUMER' | 'PROVIDER';

export type OrderLifecycleRecord = Pick<
  Order,
  | 'consumer_id'
  | 'owner_id'
  | 'status'
  | 'frozen_points'
  | 'start_time'
  | 'service_id'
  | 'metadata'
> & {
  service?: OrderLifecycleServiceSnapshot | undefined;
};

export type OrderCancellationSettlement = {
  penaltyAmount: number;
  refundAmount: number;
  shouldSettleFrozenCredit: boolean;
};

export const ORDER_CANCELLATION_BLOCKED_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.FORFEITED,
  OrderStatus.DISPUTED,
  OrderStatus.CANCELLED,
];
