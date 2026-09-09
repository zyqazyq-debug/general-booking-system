import type { NotificationDeliveryResult } from '../channels/notification-delivery-result';

export const TELEGRAM_NOTIFICATION_CHANNEL = 'ITelegramNotificationChannel';

export interface ITelegramNotificationChannel {
  send(
    recipient: string,
    content: string,
    title?: string,
  ): Promise<NotificationDeliveryResult>;
}
