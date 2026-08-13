export interface OrderAvailabilityPort {
  invalidateCache(serviceId: string): Promise<void>;
}
