import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AuthService } from '../auth.service';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';
import type { TelegramBotProfile } from '../interfaces/telegram-validator.interface';
import type { AuthUserDto } from '../dto/auth-user.dto';

export type PlatformUserDto = {
  id: string;
  username: string;
  phone: string | null;
  nickname: string | null;
  avatar: string | null;
  roles: string[];
  referral_code: string | null;
  referrer_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
};

@Injectable()
export class PlatformAuthAdapter {
  constructor(
    private readonly authService: AuthService,
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
  ) {}

  private mapUser(user: AuthUserDto): PlatformUserDto {
    return {
      id: user.id,
      username: user.username,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      roles: Array.isArray(user.roles) ? user.roles : [],
      referral_code: user.referral_code,
      referrer_id: null,
      telegram_chat_id: user.telegram_chat_id,
      telegram_username: user.telegram_username,
    };
  }

  async login(
    user: PlatformUserDto,
    deviceInfo?: Record<string, unknown>,
  ): Promise<unknown> {
    const entity = await this.usersPort.findOne(user.id);
    if (!entity) throw new NotFoundException('User not found');
    const { password: _password, ...loginUser } = entity;
    void _password;
    return this.authService.login(loginUser, deviceInfo);
  }

  async loginByChatId(
    chatId: string,
    telegramUser?: unknown,
  ): Promise<unknown> {
    const profile =
      telegramUser && typeof telegramUser === 'object'
        ? (telegramUser as TelegramBotProfile)
        : undefined;
    return this.authService.loginByChatId(chatId, profile);
  }

  async performAccountMerge(
    manager: EntityManager,
    sourceUser: PlatformUserDto,
    targetUser: PlatformUserDto,
  ): Promise<PlatformUserDto> {
    const source = await this.usersPort.findOneTx(manager, sourceUser.id);
    const target = await this.usersPort.findOneTx(manager, targetUser.id);
    if (!source || !target) {
      throw new NotFoundException('User not found');
    }
    const merged = await this.authService.performAccountMerge(
      manager,
      source,
      target,
    );
    return this.mapUser(merged);
  }
}
