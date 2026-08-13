import { TimeSlotGenerator } from './time-slot-generator';
import type { Service } from '../entities/service.entity';
import type { ServiceBlock } from '../entities/service-block.entity';

type OrderRecord = {
  start_time: Date;
  end_time: Date;
};

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextDayOfWeek(targetDow: number): Date {
  const now = new Date();
  const dow = now.getDay();
  const delta = (targetDow - dow + 7) % 7 || 7;
  const res = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
  res.setHours(0, 0, 0, 0);
  return res;
}

describe('TimeSlotGenerator', () => {
  it('generates slots when rules are missing (defaults to 00:00-24:00)', () => {
    const service = {
      duration_minutes: 60,
      buffer_minutes: 0,
    } as unknown as Service;
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = formatDate(tomorrow);
    const slots = TimeSlotGenerator.generateSlots(
      service,
      dateStr,
      [] as OrderRecord[],
      [] as ServiceBlock[],
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.status === 'available')).toBeTruthy();
  });

  it('accepts 1-7 weekdays mapping where 7 represents Sunday', () => {
    const nextSunday = nextDayOfWeek(0);
    const dateStr = formatDate(nextSunday);
    const service = {
      duration_minutes: 60,
      buffer_minutes: 0,
      rules: {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start_hour: 9,
        end_hour: 18,
      },
    } as unknown as Service;
    const slots = TimeSlotGenerator.generateSlots(
      service,
      dateStr,
      [] as OrderRecord[],
      [] as ServiceBlock[],
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.status === 'available')).toBeTruthy();
  });

  it('returns empty when day is not allowed by weekdays', () => {
    const nextSunday = nextDayOfWeek(0);
    const dateStr = formatDate(nextSunday);
    const service = {
      duration_minutes: 60,
      buffer_minutes: 0,
      rules: {
        weekdays: [1],
        start_hour: 9,
        end_hour: 18,
      },
    } as unknown as Service;
    const slots = TimeSlotGenerator.generateSlots(
      service,
      dateStr,
      [] as OrderRecord[],
      [] as ServiceBlock[],
    );
    expect(slots.length).toBe(0);
  });
});
