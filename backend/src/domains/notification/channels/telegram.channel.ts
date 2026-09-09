import { Injectable, Logger, Inject } from '@nestjs/common';
import { NotificationChannel } from './notification-channel.interface';
import { TELEGRAM_NOTIFICATION_CHANNEL } from '../interfaces/telegram-notification-channel.interface';
import type { ITelegramNotificationChannel } from '../interfaces/telegram-notification-channel.interface';
import type { NotificationDeliveryResult } from './notification-delivery-result';

@Injectable()
export class TelegramChannel implements NotificationChannel {
  private readonly logger = new Logger(TelegramChannel.name);

  constructor(
    @Inject(TELEGRAM_NOTIFICATION_CHANNEL)
    private readonly telegramService: ITelegramNotificationChannel,
  ) {}

  get name(): string {
    return 'telegram';
  }

  async send(
    recipient: string,
    content: string,
    title?: string,
  ): Promise<NotificationDeliveryResult> {
    try {
      if (!recipient) {
        this.logger.warn('Recipient chat ID is missing');
        return { outcome: 'failed', errorType: 'RecipientUnavailable' };
      }
      return await this.telegramService.send(recipient, content, title);
    } catch {
      this.logger.error('Telegram channel returned an unhandled error');
      return { outcome: 'uncertain', errorType: 'ChannelUnhandledError' };
    }
  }
}
