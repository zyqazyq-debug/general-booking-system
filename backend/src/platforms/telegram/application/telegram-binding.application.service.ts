import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TelegramBindingService } from '../bot/services/telegram-binding.service';
import type { PlatformAuthPort, PlatformUsersPort } from '../../platform-ports';
import { PLATFORM_AUTH_PORT, PLATFORM_USERS_PORT } from '../../platform-ports';

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
  ) {}

  async loginByDeepLinkToken(
    token: string,
    chatId: string,
    profile?: TelegramProfile,
  ): Promise<'invalid' | 'success'> {
    const status = this.telegramBindingService.getTokenStatus(token);
    if (status.status !== 'pending') {
      return 'invalid';
    }

    const loginRes = await this.authPort.loginByChatId(chatId, profile);
    this.telegramBindingService.completeToken(token, loginRes);
    return 'success';
  }

  async bindByToken(
    token: string,
    chatId: string,
    telegramUsername?: string,
  ): Promise<BindTokenResult> {
    const initiatorUserId = this.telegramBindingService.verifyToken(token);
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

    targetUser.telegram_chat_id = chatId;
    targetUser.telegram_username = telegramUsername || '';
    await this.usersPort.save(targetUser);

    const loginRes = await this.authPort.login(targetUser);
    this.telegramBindingService.completeToken(token, loginRes);

    return { status: 'bound' };
  }

  async confirmMergeByToken(
    token: string,
    chatId: string,
  ): Promise<'invalid' | 'merged' | 'noop'> {
    const initiatorUserId = this.telegramBindingService.verifyToken(token);
    if (!initiatorUserId) {
      return 'invalid';
    }

    const existingUser = await this.usersPort.findByTelegram(chatId);
    const targetUser = await this.usersPort.findOne(initiatorUserId);

    if (!existingUser || !targetUser) {
      return 'noop';
    }

    const mergedUser = await this.dataSource.transaction(async (manager) =>
      this.authPort.performAccountMerge(manager, targetUser, existingUser),
    );
    const loginRes = await this.authPort.login(mergedUser);
    this.telegramBindingService.completeToken(token, loginRes);
    return 'merged';
  }
}
