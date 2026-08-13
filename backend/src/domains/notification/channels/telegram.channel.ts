import { Injectable, Logger, Inject } from '@nestjs/common';
import { NotificationChannel } from './notification-channel.interface';
import { TELEGRAM_NOTIFICATION_CHANNEL } from '../interfaces/telegram-notification-channel.interface';
import type { ITelegramNotificationChannel } from '../interfaces/telegram-notification-channel.interface';

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
  ): Promise<boolean> {
    try {
      if (!recipient) {
        this.logger.warn('Recipient chat ID is missing');
        return false;
      }
      return await this.telegramService.send(recipient, content, title);
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram message to ${recipient}`,
        error,
      );
      return false;
    }
  }
}
