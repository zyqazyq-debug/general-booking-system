import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, LessThan, MoreThan, Not } from 'typeorm';
import { Service, ServiceBlock } from '../../services';
import type { OrderServiceSnapshot } from '../ports/order-services.port';
import { Order, OrderStatus } from '../entities/order.entity';

export class OrderValidator {
  static validateSchedule(
    service: OrderServiceSnapshot | null,
    startTime: Date,
    endTime: Date,
  ) {
    if (!service) throw new NotFoundException('Service not found');
    if (!service.is_active)
      throw new BadRequestException('Service is not active');
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid schedule time');
    }
    if (startTime >= endTime) {
      throw new BadRequestException('End time must be later than start time');
    }

    // 1. Check weekdays (use JS weekday: 0-6, where 0=Sunday)
    if (service.rules?.weekdays) {
      const day = startTime.getDay(); // 0-6
      const weekdays = Array.isArray(service.rules.weekdays)
        ? service.rules.weekdays.map((w) => (w === 7 ? 0 : w))
        : [];
      if (!weekdays.includes(day)) {
        throw new BadRequestException('Service not available on this day');
      }
    }

    // 2. Check business hours (Start Time)
    // We only check if the START time is within the allowed start window.
    // We allow the service to extend beyond end_hour (cross-day).
    if (
      service.rules?.start_hour !== undefined &&
      service.rules?.end_hour !== undefined
    ) {
      const startHour = Number(service.rules.start_hour);
      const endHour = Number(service.rules.end_hour);
      if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
        throw new BadRequestException('Invalid service business hours');
      }
      const requestHour = startTime.getHours();

      // Case 1: Standard hours (e.g. 09:00 - 18:00)
      if (startHour < endHour) {
        if (requestHour < startHour || requestHour >= endHour) {
          throw new BadRequestException(
            `Service available between ${startHour}:00 and ${endHour}:00`,
          );
        }
      }
      // Case 2: Cross-day hours (e.g. 20:00 - 04:00) OR 0-24 (start=0, end=24 or end=0)
      else {
        // If endHour <= startHour (e.g. 20 to 4, or 0 to 0)
        // Available if: hour >= start (20..23) OR hour < end (0..3)
        const isAfterStart = requestHour >= startHour;
        const isBeforeEnd = requestHour < endHour;

        if (!isAfterStart && !isBeforeEnd) {
          throw new BadRequestException(
            `Service available between ${startHour}:00 and ${endHour}:00`,
          );
        }
      }
    }
  }

  static async checkTimeSlotAvailability(
    manager: EntityManager,
    serviceId: string,
    startTime: Date,
    endTime: Date,
  ) {
    const service = await manager.findOne(Service, {
      where: { id: serviceId },
    });
    if (!service) throw new NotFoundException('Service not found');

    // Check conflict across ALL services of the same provider
    const conflictingOrder = await manager.findOne(Order, {
      where: {
        owner_id: service.owner_id,
        start_time: LessThan(endTime),
        end_time: MoreThan(startTime),
        status: Not(OrderStatus.CANCELLED),
      },
    });

    if (conflictingOrder && conflictingOrder.status !== OrderStatus.FORFEITED) {
      throw new BadRequestException('Time slot already booked (provider busy)');
    }

    const conflictingBlock = await manager.findOne(ServiceBlock, {
      where: {
        service_id: serviceId,
        start_time: LessThan(endTime),
        end_time: MoreThan(startTime),
      },
    });

    if (conflictingBlock) {
      throw new BadRequestException('Service is on break during this time');
    }
  }
}
