export interface OrderCreatedEvent {
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
