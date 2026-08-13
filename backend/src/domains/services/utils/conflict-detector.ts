import { ServiceBlock } from '../entities/service-block.entity';

type BookingOrder = {
  start_time: Date | string;
  end_time: Date | string;
};

export class ConflictDetector {
  static hasConflict(
    slotStart: Date,
    slotEnd: Date,
    orders: BookingOrder[],
    blocks: ServiceBlock[] = [],
    bufferMinutes: number = 0,
  ): boolean {
    const bufferMs = bufferMinutes * 60 * 1000;

    for (const order of orders) {
      const oStart = new Date(order.start_time);
      const oEnd = new Date(order.end_time);

      // Check for overlap with buffer
      // Slot: [Start, End]
      // Order: [OStart, OEnd]
      // Buffer applies to the gap between them.
      // So effectively, we can expand the Order duration by buffer on both sides?
      // Or expand Slot?
      // "Buffer time after service" means after a service ends, there must be X minutes gap.
      // So:
      // New Slot Start must be >= Existing Order End + Buffer
      // Existing Order Start must be >= New Slot End + Buffer

      const orderEndWithBuffer = new Date(oEnd.getTime() + bufferMs);
      const slotEndWithBuffer = new Date(slotEnd.getTime() + bufferMs);

      // Conflict condition:
      // (SlotStart < OrderEnd + Buffer) AND (SlotEnd + Buffer > OrderStart)
      // Standard Overlap: (StartA < EndB) && (EndA > StartB)

      if (
        slotStart.getTime() < orderEndWithBuffer.getTime() &&
        slotEndWithBuffer.getTime() > oStart.getTime()
      ) {
        return true;
      }
    }

    for (const block of blocks) {
      const bStart = new Date(block.start_time);
      const bEnd = new Date(block.end_time);

      // Simple overlap check for blocks
      // (SlotStart < BlockEnd) && (SlotEnd > BlockStart)
      // Note: We don't apply buffer to blocks for now, as blocks are usually "unavailable time"
      // and don't necessarily imply a service that needs cleanup.
      if (
        slotStart.getTime() < bEnd.getTime() &&
        slotEnd.getTime() > bStart.getTime()
      ) {
        return true;
      }
    }

    return false;
  }
}
