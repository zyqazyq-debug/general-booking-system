import { BadRequestException } from '@nestjs/common';
import { OrderValidator } from './order-validator';
import type { Service } from '../../services';

function nextDayOfWeek(targetDow: number): Date {
  const now = new Date();
  const dow = now.getDay();
  const delta = (targetDow - dow + 7) % 7 || 7;
  const res = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
  return res;
}

describe('OrderValidator.validateSchedule', () => {
  it('allows booking when weekdays use 7 as Sunday and start/end are valid', () => {
    const nextSunday = nextDayOfWeek(0);
    const start = new Date(nextSunday);
    start.setHours(9, 0, 0, 0);
    const end = new Date(nextSunday);
    end.setHours(10, 0, 0, 0);
    const service = {
      is_active: true,
      rules: {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start_hour: 9,
        end_hour: 18,
      },
      duration_minutes: 60,
    } as unknown as Service;
    expect(() =>
      OrderValidator.validateSchedule(service, start, end),
    ).not.toThrow();
  });

  it('rejects booking when day not allowed by weekdays', () => {
    const nextSunday = nextDayOfWeek(0);
    const start = new Date(nextSunday);
    start.setHours(9, 0, 0, 0);
    const end = new Date(nextSunday);
    end.setHours(10, 0, 0, 0);
    const service = {
      is_active: true,
      rules: {
        weekdays: [1],
        start_hour: 9,
        end_hour: 18,
      },
      duration_minutes: 60,
    } as unknown as Service;
    expect(() => OrderValidator.validateSchedule(service, start, end)).toThrow(
      BadRequestException,
    );
  });
});
