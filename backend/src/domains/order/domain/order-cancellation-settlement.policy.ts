import { OrderStatus } from '../entities/order.entity';
import type {
  OrderCancellationPolicySnapshot,
  OrderCancellationSettlement,
  OrderLifecycleActorRole,
} from './order-lifecycle.types';

type ComputeCancellationSettlementParams = {
  actorRole: OrderLifecycleActorRole;
  status: OrderStatus;
  frozenPoints: number;
  startTime: Date | string;
  cancellationPolicy?: OrderCancellationPolicySnapshot | undefined;
  now?: Date;
};

export class OrderCancellationSettlementPolicy {
  static compute(
    params: ComputeCancellationSettlementParams,
  ): OrderCancellationSettlement {
    const shouldSettleFrozenCredit =
      params.status === OrderStatus.RESERVED && params.frozenPoints > 0;

    if (
      params.actorRole !== 'CONSUMER' ||
      params.status !== OrderStatus.RESERVED ||
      params.frozenPoints <= 0
    ) {
      return {
        penaltyAmount: 0,
        refundAmount: this.roundCurrency(params.frozenPoints),
        shouldSettleFrozenCredit,
      };
    }

    const penaltyPercent = params.cancellationPolicy?.penalty_percent ?? 0;
    if (penaltyPercent <= 0) {
      return {
        penaltyAmount: 0,
        refundAmount: this.roundCurrency(params.frozenPoints),
        shouldSettleFrozenCredit,
      };
    }

    const now = params.now ?? new Date();
    const startTime = new Date(params.startTime);
    const minutesUntilStart =
      (startTime.getTime() - now.getTime()) / (1000 * 60);
    const windowMinutes = params.cancellationPolicy?.window_minutes ?? 0;

    if (minutesUntilStart >= windowMinutes) {
      return {
        penaltyAmount: 0,
        refundAmount: this.roundCurrency(params.frozenPoints),
        shouldSettleFrozenCredit,
      };
    }

    const penaltyAmount = this.roundCurrency(
      (params.frozenPoints * penaltyPercent) / 100,
    );
    const refundAmount = this.roundCurrency(
      params.frozenPoints - penaltyAmount,
    );

    return {
      penaltyAmount,
      refundAmount,
      shouldSettleFrozenCredit,
    };
  }

  private static roundCurrency(value: number) {
    return Math.round(value * 100) / 100;
  }
}
