import { Service } from '../entities/service.entity';
import { ConflictDetector } from './conflict-detector';
import { ServiceBlock } from '../entities/service-block.entity';

export interface TimeSlot {
  start_time: string;
  end_time: string;
  status: 'available' | 'booked';
}

export class TimeSlotGenerator {
  static generateSlots(
    service: Service,
    dateStr: string,
    orders: Array<{ start_time: Date | string; end_time: Date | string }>,
    blocks: ServiceBlock[] = [],
  ): TimeSlot[] {
    const { rules: rawRules, duration_minutes, buffer_minutes } = service;
    const rules = (rawRules || {}) as Record<string, unknown>;
    const hasOwn = (obj: object, prop: string): boolean =>
      Boolean(Object.prototype.hasOwnProperty.call(obj, prop));
    const toHour = (v: unknown): number | null => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 24) return n;
      return null;
    };
    const hasHours = hasOwn(rules, 'start_hour') || hasOwn(rules, 'end_hour');
    const startHourRaw = toHour(rules.start_hour);
    const endHourRaw = toHour(rules.end_hour);
    const startHour = startHourRaw !== null ? startHourRaw : hasHours ? NaN : 0;
    const endHour = endHourRaw !== null ? endHourRaw : hasHours ? NaN : 24;
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
      return [];
    }

    // Parse dateStr to get the start of the day
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);

    const dayOfWeek = startOfDay.getDay(); // 0-6 (0=Sunday)

    // Check weekday rule
    if (Array.isArray(rules.weekdays) && rules.weekdays.length > 0) {
      const hasZeroBased = rules.weekdays.some((w: number) => w >= 0 && w <= 6);
      const allowed = new Set<number>();
      if (hasZeroBased) {
        rules.weekdays.forEach((w: number) =>
          allowed.add(w === 7 ? 0 : Number(w)),
        );
      } else {
        rules.weekdays.forEach((w: number) =>
          allowed.add(w === 0 ? 7 : Number(w)),
        );
      }
      const currentDay1to7 = dayOfWeek === 0 ? 7 : dayOfWeek;
      if (!allowed.has(hasZeroBased ? dayOfWeek : currentDay1to7)) {
        return [];
      }
    }

    const slots: TimeSlot[] = [];
    const step = 30; // Fixed step in minutes

    // Start time in minutes from midnight
    let currentMinutes = startHour * 60;
    let endMinutes = endHour * 60;

    // Handle overnight end time (e.g. 22:00 to 02:00)
    // If end_hour <= start_hour, it means it spans to next day
    if (endHour <= startHour) {
      endMinutes += 24 * 60;
    }

    const now = new Date();

    while (currentMinutes < endMinutes) {
      // Calculate slot start time
      const slotStart = new Date(startOfDay.getTime() + currentMinutes * 60000);

      // Calculate slot end time
      const slotEnd = new Date(slotStart.getTime() + duration_minutes * 60000);

      // Check if slot is in the past
      if (slotStart.getTime() <= now.getTime()) {
        slots.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          status: 'booked',
        });
      } else {
        // Check conflicts
        const isBooked = ConflictDetector.hasConflict(
          slotStart,
          slotEnd,
          orders,
          blocks,
          buffer_minutes,
        );

        slots.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          status: isBooked ? 'booked' : 'available',
        });
      }

      currentMinutes += step;
    }

    return slots;
  }
}
