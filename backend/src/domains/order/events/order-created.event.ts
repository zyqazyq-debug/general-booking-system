export interface OrderCreatedEvent {
  /** Stable outbox event identity for idempotent downstream consumers. */
  eventId?: string;
  orderId: string;
  orderNo: string;
  serviceId: string | null;
  agencyNodeId?: string | null;
  customerId: string;
  providerId: string;
  priceSnapshot: {
    basePrice: number;
    displayPrice: number;
  };
}
