import { ConflictDetector } from './conflict-detector';
import { Order } from '../../order';
import { ServiceBlock } from '../entities/service-block.entity';

describe('ConflictDetector', () => {
  const createDate = (hours: number, minutes: number = 0) => {
    const d = new Date('2024-01-01T00:00:00.000Z');
    d.setUTCHours(hours, minutes);
    return d;
  };

  describe('hasConflict', () => {
    it('should return false when there are no orders and blocks', () => {
      const start = createDate(10, 0); // 10:00
      const end = createDate(11, 0); // 11:00

      expect(ConflictDetector.hasConflict(start, end, [], [])).toBe(false);
    });

    it('should detect conflict with an existing order overlapping', () => {
      const slotStart = createDate(10, 0); // 10:00
      const slotEnd = createDate(11, 0); // 11:00

      const orders = [
        {
          start_time: createDate(10, 30).toISOString(),
          end_time: createDate(11, 30).toISOString(),
        } as unknown as Order,
      ];

      expect(ConflictDetector.hasConflict(slotStart, slotEnd, orders, [])).toBe(
        true,
      );
    });

    it('should not detect conflict when slot is completely before order', () => {
      const slotStart = createDate(9, 0); // 09:00
      const slotEnd = createDate(10, 0); // 10:00

      const orders = [
        {
          start_time: createDate(10, 0).toISOString(),
          end_time: createDate(11, 0).toISOString(),
        } as unknown as Order,
      ];

      expect(ConflictDetector.hasConflict(slotStart, slotEnd, orders, [])).toBe(
        false,
      );
    });

    it('should not detect conflict when slot is completely after order', () => {
      const slotStart = createDate(11, 0); // 11:00
      const slotEnd = createDate(12, 0); // 12:00

      const orders = [
        {
          start_time: createDate(10, 0).toISOString(),
          end_time: createDate(11, 0).toISOString(),
        } as unknown as Order,
      ];

      expect(ConflictDetector.hasConflict(slotStart, slotEnd, orders, [])).toBe(
        false,
      );
    });

    it('should detect conflict with buffer time', () => {
      // Order: 10:00 - 11:00
      // Slot: 11:10 - 12:00
      // Buffer: 15 mins
      // Slot should be rejected because it starts within 15 mins of Order's end.

      const orders = [
        {
          start_time: createDate(10, 0).toISOString(),
          end_time: createDate(11, 0).toISOString(),
        } as unknown as Order,
      ];

      const slotStart = createDate(11, 10); // 11:10
      const slotEnd = createDate(12, 0); // 12:00

      expect(
        ConflictDetector.hasConflict(slotStart, slotEnd, orders, [], 15),
      ).toBe(true);

      // But it should be fine if buffer is 5 mins
      expect(
        ConflictDetector.hasConflict(slotStart, slotEnd, orders, [], 5),
      ).toBe(false);
    });

    it('should detect conflict with service blocks', () => {
      const slotStart = createDate(14, 0); // 14:00
      const slotEnd = createDate(15, 0); // 15:00

      const blocks = [
        {
          start_time: createDate(14, 30).toISOString(),
          end_time: createDate(16, 0).toISOString(),
        } as unknown as ServiceBlock,
      ];

      expect(ConflictDetector.hasConflict(slotStart, slotEnd, [], blocks)).toBe(
        true,
      );
    });

    it('should ignore buffer for service blocks', () => {
      const slotStart = createDate(16, 0); // 16:00
      const slotEnd = createDate(17, 0); // 17:00

      const blocks = [
        {
          start_time: createDate(14, 0).toISOString(), // Block: 14:00 - 16:00
          end_time: createDate(16, 0).toISOString(),
        } as unknown as ServiceBlock,
      ];

      // Buffer is 30 mins, but it shouldn't apply to blocks
      expect(
        ConflictDetector.hasConflict(slotStart, slotEnd, [], blocks, 30),
      ).toBe(false);
    });
  });
});
