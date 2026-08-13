import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';
import { UsersReferralService } from './users-referral.service';

type TelegramUserProfile = {
  username?: string;
  first_name?: string;
  last_name?: string;
};

@Injectable()
export class UsersIdentityService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly usersReferralService: UsersReferralService,
  ) {}

  findByUsername(username: string) {
    return this.usersRepository.findOneBy({ username });
  }

  findByEmail(email: string) {
    return this.usersRepository.findOneBy({ email });
  }

  findByPhone(phone: string) {
    return this.usersRepository.findOneBy({
      phone,
      status: UserStatus.ACTIVE,
    });
  }

  findByWechat(openid: string) {
    return this.usersRepository.findOneBy({
      wechat_openid: openid,
      status: UserStatus.ACTIVE,
    });
  }

  findByWechatAny(openid: string) {
    return this.usersRepository.findOneBy({
      wechat_openid: openid,
    });
  }

  findByTelegram(telegramId: string) {
    return this.usersRepository.findOneBy({
      telegram_chat_id: telegramId,
      status: UserStatus.ACTIVE,
    });
  }

  findByQQ(openid: string) {
    return this.usersRepository.findOneBy({
      qq_openid: openid,
      status: UserStatus.ACTIVE,
    });
  }

  findByQQAny(openid: string) {
    return this.usersRepository.findOneBy({
      qq_openid: openid,
    });
  }

  async findForAuth(usernameOrPhone: string) {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where(
        '(user.username = :input OR user.phone = :input) AND user.status = :status',
        {
          input: usernameOrPhone,
          status: UserStatus.ACTIVE,
        },
      )
      .getOne();
  }

  async findByIdForAuth(id: string) {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('user.id = :id AND user.status = :status', {
        id,
        status: UserStatus.ACTIVE,
      })
      .getOne();
  }

  async createWithProvider(data: Partial<User>) {
    const salt = await bcrypt.genSalt();
    const randomPass = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(randomPass, salt);
    const referralCode =
      await this.usersReferralService.buildUniqueReferralCode();

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
      wallet_balance: 0,
      credit_balance: 100,
      roles: ['CONSUMER'],
      referral_code: referralCode,
    });
    return this.usersRepository.save(user);
  }

  async syncTelegramUser(
    userOrChatId: string | User,
    telegramUser: TelegramUserProfile | null,
  ) {
    if (!telegramUser) {
      return null;
    }

    const user =
      typeof userOrChatId === 'string'
        ? await this.findByTelegram(userOrChatId)
        : userOrChatId;

    if (!user) {
      return null;
    }

    let changed = false;
    const newUsername = telegramUser.username || '';
    const newNickname =
      [telegramUser.first_name, telegramUser.last_name]
        .filter(Boolean)
        .join(' ') || `TG User ${user.telegram_chat_id}`;

    if (user.telegram_username !== newUsername) {
      user.telegram_username = newUsername;
      changed = true;
    }

    if (user.nickname !== newNickname && user.username.startsWith('tg_')) {
      user.nickname = newNickname;
      changed = true;
    }

    if (!changed) {
      return user;
    }

    return this.usersRepository.save(user);
  }
}
