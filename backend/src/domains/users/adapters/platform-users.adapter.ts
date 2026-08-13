import { Injectable, NotFoundException } from '@nestjs/common';
import type { User as TelegramUser } from 'telegraf/types';

import { UsersService } from '../users.service';
import type { User } from '../entities/user.entity';

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
export class PlatformUsersAdapter {
  constructor(private readonly usersService: UsersService) {}

  private mapUser(user: User): PlatformUserDto {
    return {
      id: user.id,
      username: user.username,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      roles: Array.isArray(user.roles) ? user.roles : [],
      referral_code: user.referral_code,
      referrer_id: user.referrer_id,
      telegram_chat_id: user.telegram_chat_id,
      telegram_username: user.telegram_username,
    };
  }

  async findByTelegram(chatId: string): Promise<PlatformUserDto | null> {
    const user = await this.usersService.findByTelegram(chatId);
    if (!user) return null;
    return this.mapUser(user);
  }

  async findByReferralCode(code: string): Promise<PlatformUserDto | null> {
    const user = await this.usersService.findByReferralCode(code);
    if (!user) return null;
    return this.mapUser(user);
  }

  async findOne(id: string): Promise<PlatformUserDto | null> {
    const user = await this.usersService.findOne(id);
    if (!user) return null;
    return this.mapUser(user);
  }

  async save(user: PlatformUserDto): Promise<PlatformUserDto> {
    const existing = await this.usersService.findOne(user.id);
    if (!existing) throw new NotFoundException('User not found');

    existing.telegram_chat_id = user.telegram_chat_id;
    existing.telegram_username = user.telegram_username;
    if (user.nickname !== undefined) {
      existing.nickname = user.nickname;
    }
    if (user.avatar !== undefined) {
      existing.avatar = user.avatar;
    }
    if (user.phone !== undefined) {
      existing.phone = user.phone;
    }
    if (user.referrer_id !== undefined) {
      existing.referrer_id = user.referrer_id;
    }

    const saved = await this.usersService.save(existing);
    return this.mapUser(saved);
  }

  async syncTelegramUser(
    userOrChatId: string | PlatformUserDto,
    telegramUser: TelegramUser,
  ): Promise<PlatformUserDto | null> {
    const profile = {
      username: telegramUser.username,
      first_name: telegramUser.first_name,
      last_name: telegramUser.last_name,
    };

    if (typeof userOrChatId === 'string') {
      const updated = await this.usersService.syncTelegramUser(
        userOrChatId,
        profile,
      );
      if (!updated) return null;
      return this.mapUser(updated);
    }

    const existing = await this.usersService.findOne(userOrChatId.id);
    if (!existing) return null;
    const updated = await this.usersService.syncTelegramUser(existing, profile);
    if (!updated) return null;
    return this.mapUser(updated);
  }

  async createWithProvider(params: {
    username: string;
    telegram_chat_id?: string;
    telegram_username?: string;
    nickname?: string;
    avatar?: string;
    roles?: string[];
    is_verified?: boolean;
  }): Promise<PlatformUserDto> {
    const user = await this.usersService.createWithProvider(
      params as Partial<User>,
    );
    return this.mapUser(user);
  }
}
