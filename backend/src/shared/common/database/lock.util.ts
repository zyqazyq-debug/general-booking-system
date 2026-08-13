const UNSUPPORTED_PESSIMISTIC_LOCK_DRIVERS = new Set([
  'sqlite',
  'better-sqlite3',
  'sqljs',
  'expo',
]);

export function supportsPessimisticWriteLock(driverType?: string): boolean {
  if (!driverType) {
    return true;
  }
  return !UNSUPPORTED_PESSIMISTIC_LOCK_DRIVERS.has(driverType);
}

export function pessimisticWriteLockIfSupported(driverType?: string): {
  lock?: { mode: 'pessimistic_write' };
} {
  if (!supportsPessimisticWriteLock(driverType)) {
    return {};
  }
  return { lock: { mode: 'pessimistic_write' } };
}
