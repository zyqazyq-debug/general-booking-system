import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { User } from 'telegraf/types';
import type { PlatformUsersPort } from '../../../platform-ports';
import { PLATFORM_USERS_PORT } from '../../../platform-ports';
import { TelegramWebhookMutationFenceService } from '../../persistence/telegram-webhook-mutation-fence.service';

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  constructor(
    @Inject(PLATFORM_USERS_PORT)
    private readonly usersPort: PlatformUsersPort,
    @Optional()
    private readonly mutationFence?: TelegramWebhookMutationFenceService,
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
      this.logger.log('[TelegramAuth] Auto-registering Telegram user.');

      const username = `tg_${chatId}`;
      const nickname = telegramUser
        ? [telegramUser.first_name, telegramUser.last_name]
            .filter(Boolean)
            .join(' ')
        : `TG User ${chatId}`;

      try {
        const createUser = () =>
          this.usersPort.createWithProvider({
            username,
            telegram_chat_id: chatIdStr,
            telegram_username: telegramUser?.username,
            nickname,
            roles: ['CONSUMER'],
          });
        user = this.mutationFence
          ? await this.mutationFence.executeOnce(
              'create_telegram_user',
              chatIdStr,
              createUser,
            )
          : await createUser();
      } catch (e: unknown) {
        this.logger.error('[TelegramAuth] Registration failed.');
        throw e;
      }
    } else if (telegramUser) {
      // 3. Sync profile if user exists and we have fresh info. Webhook writes
      // are awaited so inbox completion cannot race this mutation.
      const existingUser = user;
      const syncUser = () =>
        this.usersPort.syncTelegramUser(existingUser, telegramUser);
      if (this.mutationFence) {
        await this.mutationFence.executeOnceVoid(
          'sync_telegram_user',
          chatIdStr,
          syncUser,
        );
      } else {
        void syncUser().catch(() => {
          this.logger.warn('[TelegramAuth] Sync failed.');
        });
      }
    }

    return user;
  }
}
