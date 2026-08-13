import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramChannel } from '../channels/telegram.channel';
import type { NotificationUsersPort } from '../ports/notification-users.port';
import { NOTIFICATION_USERS_PORT } from '../ports/tokens';

@Injectable()
export class NotificationListener implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationListener.name);
  private readonly recentPriceAlerts = new Map<string, number>();
  private readonly priceAlertWindowMs = 60_000;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly telegramChannel: TelegramChannel,
    @Inject(NOTIFICATION_USERS_PORT)
    private readonly usersPort: NotificationUsersPort,
  ) {}

  @OnEvent('price.markup_changed')
  async handlePriceChanged(payload: {
    nodeId: string;
    oldPrice: number;
    newPrice: number;
    affectedUserIds: string[];
  }) {
    const task = (async () => {
      this.logger.log(
        `Handling price.markup_changed for Node ${payload.nodeId}`,
      );
      const now = Date.now();

      for (const userId of payload.affectedUserIds) {
        const key = `${payload.nodeId}:${userId}:${payload.newPrice}`;
        const lastSent = this.recentPriceAlerts.get(key);
        if (lastSent && now - lastSent < this.priceAlertWindowMs) {
          continue;
        }
        this.recentPriceAlerts.set(key, now);
        await this.notifyUser(
          userId,
          'Price Update Alert',
          `The price for service has changed from ${payload.oldPrice} to ${payload.newPrice}. Check your margins.`,
        );
      }
    })();

    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  private async notifyUser(userId: string, title: string, content: string) {
    try {
      const user = await this.usersPort.findContactById(userId);
      if (!user) return;
      if (user.telegram_chat_id) {
        await this.telegramChannel.send(user.telegram_chat_id, content, title);
      }
    } catch (error) {
      this.logger.error(`Failed to notify user ${userId}`, error);
    }
  }

  async onModuleDestroy() {
    const tasks = Array.from(this.inFlight);
    await Promise.allSettled(tasks);
  }
}
