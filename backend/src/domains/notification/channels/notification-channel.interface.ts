import type { NotificationDeliveryResult } from './notification-delivery-result';

export interface NotificationChannel {
  send(
    recipient: string,
    content: string,
    title?: string,
  ): Promise<NotificationDeliveryResult>;
  get name(): string;
}
