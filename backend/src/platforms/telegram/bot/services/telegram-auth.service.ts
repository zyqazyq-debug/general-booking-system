import { Injectable, Logger, Inject } from '@nestjs/common';
import { User } from 'telegraf/types';
import type { PlatformUsersPort } from '../../../platform-ports';
import { PLATFORM_USERS_PORT } from '../../../platform-ports';

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  constructor(
    @Inject(PLATFORM_USERS_PORT)
    private readonly usersPort: PlatformUsersPort,
  ) {}

  /**
   * Validate, register or sync a Telegram user from Bot context.
   * Similar to AuthService.loginTelegram but designed for Bot updates.
   */
  async validateBotUser(chatId: number, telegramUser?: User) {
    const chatIdStr = chatId.toString();

    // 1. Try find existing user
    let user = await this.usersPort.findByTelegram(chatIdStr);

    if (!user) {
      // 2. Auto-register if not found
      this.logger.log(
        `[TelegramAuth] Auto-registering user for ChatID: ${chatId}`,
      );

      const username = `tg_${chatId}`;
      const nickname = telegramUser
        ? [telegramUser.first_name, telegramUser.last_name]
            .filter(Boolean)
            .join(' ')
        : `TG User ${chatId}`;

      try {
        user = await this.usersPort.createWithProvider({
          username,
          telegram_chat_id: chatIdStr,
          telegram_username: telegramUser?.username,
          nickname,
          roles: ['CONSUMER'],
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        this.logger.error(`[TelegramAuth] Registration failed: ${error}`);
        throw e;
      }
    } else if (telegramUser) {
      // 3. Sync profile if user exists and we have fresh info
      // This is a "silent" update, we don't await it strictly or fail if it errors
      this.usersPort
        .syncTelegramUser(user, telegramUser)
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          this.logger.warn(`[TelegramAuth] Sync failed: ${error}`);
        });
    }

    return user;
  }
}
