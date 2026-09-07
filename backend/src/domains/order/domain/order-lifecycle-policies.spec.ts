import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../entities/order.entity';
import { OrderCancellationSettlementPolicy } from './order-cancellation-settlement.policy';
import { OrderRolePolicy } from './order-role-policy';
import { OrderStatusTransitionPolicy } from './order-status-transition.policy';
import {
  ORDER_NO_SHOW_GRACE_PERIOD_MINUTES,
  OrderNoShowEligibilityPolicy,
} from './order-no-show-eligibility.policy';

describe('Order lifecycle domain policies', () => {
  describe('OrderCancellationSettlementPolicy', () => {
    it('calculates penalty and refund for reserved consumer cancellation inside penalty window', () => {
      const now = new Date('2026-03-27T10:00:00.000Z');
      const result = OrderCancellationSettlementPolicy.compute({
        actorRole: 'CONSUMER',
        status: OrderStatus.RESERVED,
        frozenPoints: 88.88,
        startTime: '2026-03-27T10:20:00.000Z',
        cancellationPolicy: {
          window_minutes: 30,
          penalty_percent: 12.5,
        },
        now,
      });

      expect(result).toEqual({
        penaltyAmount: 11.11,
        refundAmount: 77.77,
        shouldSettleFrozenCredit: true,
      });
    });

    it('keeps full refund for provider cancellation even when service has penalty policy', () => {
      const result = OrderCancellationSettlementPolicy.compute({
        actorRole: 'PROVIDER',
        status: OrderStatus.RESERVED,
        frozenPoints: 50,
        startTime: '2026-03-27T10:20:00.000Z',
        cancellationPolicy: {
          window_minutes: 30,
          penalty_percent: 50,
        },
        now: new Date('2026-03-27T10:00:00.000Z'),
      });

      expect(result).toEqual({
        penaltyAmount: 0,
        refundAmount: 50,
        shouldSettleFrozenCredit: true,
      });
    });
  });

  describe('OrderStatusTransitionPolicy', () => {
    it('returns idempotent completion state for completed orders', () => {
      expect(
        OrderStatusTransitionPolicy.evaluateCompletion(OrderStatus.COMPLETED),
      ).toBe('ALREADY_COMPLETED');
    });

    it('blocks invalid cancellation status transitions', () => {
      expect(() =>
        OrderStatusTransitionPolicy.ensureCancellable(OrderStatus.FORFEITED),
      ).toThrow(new BadRequestException('Order cannot be cancelled'));
    });
  });

  describe('OrderRolePolicy', () => {
    it('uses the order owner snapshot instead of the service current owner', () => {
      const historicalOrder = {
        consumer_id: 'consumer-1',
        owner_id: 'original-provider',
        status: OrderStatus.RESERVED,
        frozen_points: 20,
        start_time: new Date('2026-03-27T10:00:00.000Z'),
        service_id: 'service-1',
        metadata: null,
        service: {
          owner_id: 'new-provider',
          cancellation_policy: null,
        },
      };

      expect(() =>
        OrderRolePolicy.ensureProviderAction(
          historicalOrder,
          'new-provider',
          'forfeit',
        ),
      ).toThrow('Not authorized to forfeit this order');
      expect(() =>
        OrderRolePolicy.ensureProviderAction(
          historicalOrder,
          'original-provider',
          'forfeit',
        ),
      ).not.toThrow();
    });

    it('prefers provider role when an actor matches both provider and consumer constraints', () => {
      const actorRole = OrderRolePolicy.resolveCancellationActorRole(
        {
          consumer_id: 'shared-user',
          owner_id: 'shared-user',
          status: OrderStatus.RESERVED,
          frozen_points: 20,
          start_time: new Date('2026-03-27T10:00:00.000Z'),
          service_id: 'service-1',
          metadata: null,
          service: {
            owner_id: 'shared-user',
            cancellation_policy: null,
          },
        },
        'shared-user',
      );

      expect(actorRole).toBe('PROVIDER');
    });
  });

  describe('OrderNoShowEligibilityPolicy', () => {
    const startTime = new Date('2026-03-27T10:00:00.000Z');

    it('rejects no-show before the appointment grace period ends', () => {
      const now = new Date('2026-03-27T10:14:59.999Z');

      expect(OrderNoShowEligibilityPolicy.canForfeit(startTime, now)).toBe(
        false,
      );
    });

    it('allows no-show when the explicit grace period has elapsed', () => {
      const now = new Date(
        startTime.getTime() + ORDER_NO_SHOW_GRACE_PERIOD_MINUTES * 60_000,
      );

      expect(OrderNoShowEligibilityPolicy.canForfeit(startTime, now)).toBe(
        true,
      );
    });
  });
});
