import { Injectable, Inject } from '@nestjs/common';
import { TelegramChannel } from '../channels/telegram.channel';
import type { OrderNotificationPort } from '../../order';
import type { NotificationUsersPort } from '../ports/notification-users.port';
import { NOTIFICATION_USERS_PORT } from '../ports/tokens';

@Injectable()
export class OrderNotificationAdapter implements OrderNotificationPort {
  constructor(
    private readonly telegramChannel: TelegramChannel,
    @Inject(NOTIFICATION_USERS_PORT)
    private readonly usersPort: NotificationUsersPort,
  ) {}

  async sendDirectMessage(userId: string, message: string): Promise<void> {
    const user = await this.usersPort.findContactById(userId);
    if (!user?.telegram_chat_id) return;
    await this.telegramChannel.send(user.telegram_chat_id, message);
  }
}
