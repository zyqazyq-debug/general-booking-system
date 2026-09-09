import {
  Injectable,
  NotFoundException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TelegramBindingService } from '../bot/services/telegram-binding.service';
import type { PlatformAuthPort, PlatformUsersPort } from '../../platform-ports';
import { PLATFORM_AUTH_PORT, PLATFORM_USERS_PORT } from '../../platform-ports';
import { TelegramWebhookMutationFenceService } from '../persistence/telegram-webhook-mutation-fence.service';

type TelegramProfile = {
  username?: string;
  first_name?: string;
  last_name?: string;
};

type BindTokenResult =
  | { status: 'invalid' }
  | { status: 'already_bound' }
  | { status: 'confirm_required'; existingName: string }
  | { status: 'bound' };

@Injectable()
export class TelegramBindingApplicationService {
  constructor(
    @Inject(PLATFORM_USERS_PORT)
    private readonly usersPort: PlatformUsersPort,
    private readonly telegramBindingService: TelegramBindingService,
    @Inject(PLATFORM_AUTH_PORT)
    private readonly authPort: PlatformAuthPort,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    private readonly mutationFence?: TelegramWebhookMutationFenceService,
  ) {}

  async loginByDeepLinkToken(
    token: string,
    chatId: string,
    profile?: TelegramProfile,
  ): Promise<'invalid' | 'success'> {
    const status = await this.telegramBindingService.peekTokenStatus(token);
    if (status.status !== 'pending') {
      if (status.status === 'success') return 'success';
      return 'invalid';
    }

    const login = () => this.authPort.loginByChatId(chatId, profile);
    const loginRes = this.mutationFence
      ? (
          await this.mutationFence.executeOnceRecoverable(
            'login_by_deep_link',
            `${chatId}:${token}`,
            login,
          )
        ).result
      : await login();
    await this.telegramBindingService.completeToken(token, loginRes);
    return 'success';
  }

  async bindByToken(
    token: string,
    chatId: string,
    telegramUsername?: string,
  ): Promise<BindTokenResult> {
    const initiatorUserId =
      await this.telegramBindingService.verifyToken(token);
    if (!initiatorUserId) {
      return { status: 'invalid' };
    }

    const existingUser = await this.usersPort.findByTelegram(chatId);
    if (existingUser) {
      if (existingUser.id === initiatorUserId) {
        return { status: 'already_bound' };
      }
      return {
        status: 'confirm_required',
        existingName: existingUser.phone || existingUser.nickname || '未命名',
      };
    }

    const targetUser = await this.usersPort.findOne(initiatorUserId);
    if (!targetUser) {
      throw new NotFoundException('目标系统账号不存在');
    }

    const bind = async () => {
      targetUser.telegram_chat_id = chatId;
      targetUser.telegram_username = telegramUsername || '';
      await this.usersPort.save(targetUser);
      const loginRes = await this.authPort.login(targetUser);
      await this.telegramBindingService.completeToken(token, loginRes);
    };
    if (this.mutationFence) {
      await this.mutationFence.executeOnce(
        'bind_telegram_account',
        `${chatId}:${initiatorUserId}:${token}`,
        bind,
      );
    } else {
      await bind();
    }

    return { status: 'bound' };
  }

  async confirmMergeByToken(
    token: string,
    chatId: string,
  ): Promise<'invalid' | 'merged' | 'noop'> {
    const initiatorUserId =
      await this.telegramBindingService.verifyToken(token);
    if (!initiatorUserId) {
      return 'invalid';
    }

    const existingUser = await this.usersPort.findByTelegram(chatId);
    const targetUser = await this.usersPort.findOne(initiatorUserId);

    if (!existingUser || !targetUser) {
      return 'noop';
    }

    const merge = async () => {
      const mergedUser = await this.dataSource.transaction(async (manager) =>
        this.authPort.performAccountMerge(manager, targetUser, existingUser),
      );
      const loginRes = await this.authPort.login(mergedUser);
      await this.telegramBindingService.completeToken(token, loginRes);
    };
    if (this.mutationFence) {
      await this.mutationFence.executeOnce(
        'merge_telegram_account',
        `${chatId}:${initiatorUserId}:${existingUser.id}:${token}`,
        merge,
      );
    } else {
      await merge();
    }
    return 'merged';
  }
}
