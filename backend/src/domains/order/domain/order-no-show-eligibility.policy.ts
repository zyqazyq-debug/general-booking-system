export const ORDER_NO_SHOW_GRACE_PERIOD_MINUTES = 15;

export class OrderNoShowEligibilityPolicy {
  static canForfeit(
    startTime: Date | string,
    now: Date = new Date(),
    gracePeriodMinutes = ORDER_NO_SHOW_GRACE_PERIOD_MINUTES,
  ): boolean {
    const scheduledStart = new Date(startTime);
    if (!Number.isFinite(scheduledStart.getTime())) return false;
    if (!Number.isFinite(now.getTime())) return false;
    if (!Number.isFinite(gracePeriodMinutes) || gracePeriodMinutes < 0) {
      return false;
    }

    const earliestForfeitAt =
      scheduledStart.getTime() + gracePeriodMinutes * 60_000;
    return now.getTime() >= earliestForfeitAt;
  }
}
