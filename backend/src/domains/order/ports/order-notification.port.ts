export type OrderNotificationDeliveryResult =
  | {
      outcome: 'sent';
      providerMessageId: string;
    }
  | {
      outcome: 'failed' | 'uncertain';
      errorType: string;
    };

export interface OrderNotificationPort {
  sendDirectMessage(
    userId: string,
    message: string,
  ): Promise<OrderNotificationDeliveryResult>;
}
