import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUserDto } from '../dto/auth-user.dto';
import type { BindIdentityProvider } from '../auth.types';
import { BusinessErrorCode } from '../../../shared/common/exceptions/business-error-code';
import { BusinessException } from '../../../shared/common/exceptions/business.exception';
import type { AuthOrderPort } from '../ports/auth-order.port';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_ORDER_PORT, AUTH_USERS_PORT } from '../ports/tokens';

@Injectable()
export class AccountMergeService {
  private readonly logger = new Logger(AccountMergeService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    @Inject(AUTH_ORDER_PORT)
    private readonly orderPort: AuthOrderPort,
  ) {}

  private verifySmsCode(phone: string, code: string) {
    if (!phone || !code) {
      throw new UnauthorizedException('Phone and Code required');
    }
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      if (code === '123456' && phone === '13800138000') {
        return;
      }
      if (code === '1234') {
        return;
      }
    }
    throw new UnauthorizedException(
      'SMS verification failed (Mock only in non-prod)',
    );
  }

  private async findUserByIdentity(
    provider: BindIdentityProvider,
    identity: string,
  ) {
    if (provider === 'phone') return this.usersPort.findByPhone(identity);
    if (provider === 'wechat') return this.usersPort.findByWechat(identity);
    if (provider === 'qq') return this.usersPort.findByQQ(identity);
    return this.usersPort.findByTelegram(identity);
  }

  private async findUserByIdentityTx(
    manager: EntityManager,
    provider: BindIdentityProvider,
    identity: string,
  ) {
    if (provider === 'phone')
      return this.usersPort.findByPhoneTx(manager, identity);
    if (provider === 'wechat')
      return this.usersPort.findByWechatTx(manager, identity);
    if (provider === 'qq') return this.usersPort.findByQQTx(manager, identity);
    return this.usersPort.findByTelegramTx(manager, identity);
  }

  private bindIdentityToUser(
    user: AuthUserDto,
    provider: BindIdentityProvider,
    identity: string,
  ) {
    if (provider === 'phone') user.phone = identity;
    if (provider === 'wechat') user.wechat_openid = identity;
    if (provider === 'qq') user.qq_openid = identity;
    if (provider === 'telegram') user.telegram_chat_id = identity;
    user.is_verified = true;
  }

  async mergeTelegramAccount(
    currentUserId: string,
    tgInfo: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    },
  ) {
    const telegramId = tgInfo.id.toString();
    const telegramUsername = tgInfo.username || '';

    return this.dataSource.transaction(async (manager) => {
      const currentUser = await this.usersPort.findOneTx(
        manager,
        currentUserId,
      );
      if (!currentUser) {
        throw new UnauthorizedException('Current user not found');
      }

      const existingUser = await this.usersPort.findByTelegramTx(
        manager,
        telegramId,
      );
      if (existingUser && existingUser.id !== currentUser.id) {
        existingUser.telegram_chat_id = null;
        existingUser.telegram_username = '';
        await this.usersPort.saveTx(manager, existingUser);
      }

      currentUser.telegram_chat_id = telegramId;
      currentUser.telegram_username = telegramUsername;
      currentUser.is_verified = true;
      return this.usersPort.saveTx(manager, currentUser);
    });
  }

  async mergeTelegramAccountWithPhone(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    this.verifySmsCode(phone, code);
    this.logger.log(
      `[Telegram Merge] request user=${currentUserId} phone=${phone.slice(0, 3)}****${phone.slice(-2)}`,
    );

    const mergedUser = await this.dataSource.transaction(async (manager) => {
      const currentUser = await this.usersPort.findOneTx(
        manager,
        currentUserId,
      );
      if (!currentUser) {
        throw new UnauthorizedException('Current user not found');
      }
      if (!currentUser.telegram_chat_id) {
        throw new BadRequestException(
          'Current account is not a Telegram account',
        );
      }

      const targetUser = await this.usersPort.findByPhoneTx(manager, phone);
      if (!targetUser) {
        throw new BadRequestException('Phone account not found');
      }

      return this.performAccountMerge(manager, currentUser, targetUser);
    });

    this.logger.log(
      `[Telegram Merge] success from=${currentUserId} to=${mergedUser.id} telegram=${mergedUser.telegram_chat_id}`,
    );

    return mergedUser;
  }

  async mergeAccountByPhone(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    this.verifySmsCode(phone, code);
    return this.dataSource.transaction(async (manager) => {
      const currentUser = await this.usersPort.findOneTx(
        manager,
        currentUserId,
      );
      if (!currentUser) {
        throw new UnauthorizedException('Current user not found');
      }
      const targetUser = await this.usersPort.findByPhoneTx(manager, phone);
      if (!targetUser) {
        throw new BadRequestException('Phone account not found');
      }

      return this.performAccountMerge(manager, currentUser, targetUser);
    });
  }

  async bindIdentityOrRequireMerge(
    currentUserId: string,
    provider: BindIdentityProvider,
    identity: string,
    code?: string,
  ) {
    if (provider === 'phone') {
      this.verifySmsCode(identity, code || '');
    }
    const currentUser = await this.usersPort.findOne(currentUserId);
    if (!currentUser) {
      throw new UnauthorizedException('Current user not found');
    }
    const existing = await this.findUserByIdentity(provider, identity);
    if (!existing || existing.id === currentUser.id) {
      this.bindIdentityToUser(currentUser, provider, identity);
      const saved = await this.usersPort.save(currentUser);
      return { status: 'bound' as const, user: saved };
    }
    return {
      status: 'merge_required' as const,
      provider,
      identity,
      target_user_id: existing.id,
    };
  }

  async confirmMergeByIdentity(
    currentUserId: string,
    provider: BindIdentityProvider,
    identity: string,
    code?: string,
  ) {
    if (provider === 'phone') {
      this.verifySmsCode(identity, code || '');
    }
    return this.dataSource.transaction(async (manager) => {
      const currentUser = await this.usersPort.findOneTx(
        manager,
        currentUserId,
      );
      if (!currentUser) {
        throw new UnauthorizedException('Current user not found');
      }
      const targetUser = await this.findUserByIdentityTx(
        manager,
        provider,
        identity,
      );
      if (!targetUser) {
        throw new BadRequestException('Identity account not found');
      }
      return this.performAccountMerge(manager, currentUser, targetUser);
    });
  }

  async bindPhoneForCurrentUser(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    this.verifySmsCode(phone, code);
    const user = await this.usersPort.findOne(currentUserId);
    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }
    if (user.phone === phone) {
      return user;
    }
    const existing = await this.usersPort.findByPhone(phone);
    if (existing && existing.id !== user.id) {
      throw BusinessException.badRequest({
        message: 'Phone already bound to another account',
        error_code: BusinessErrorCode.PHONE_ALREADY_BOUND,
      });
    }
    user.phone = phone;
    user.is_verified = true;
    return this.usersPort.save(user);
  }

  async performAccountMerge(
    manager: EntityManager,
    sourceUser: AuthUserDto,
    targetUser: AuthUserDto,
  ) {
    if (sourceUser.id === targetUser.id) return targetUser;

    this.logger.log(
      `[Account Merge] Merging source=${sourceUser.id} into target=${targetUser.id}`,
    );

    if (sourceUser.telegram_chat_id && !targetUser.telegram_chat_id) {
      targetUser.telegram_chat_id = sourceUser.telegram_chat_id;
      targetUser.telegram_username =
        targetUser.telegram_username || sourceUser.telegram_username;
    }
    if (sourceUser.wechat_openid && !targetUser.wechat_openid) {
      targetUser.wechat_openid = sourceUser.wechat_openid;
    }
    if (sourceUser.qq_openid && !targetUser.qq_openid) {
      targetUser.qq_openid = sourceUser.qq_openid;
    }
    if (sourceUser.phone && !targetUser.phone) {
      targetUser.phone = sourceUser.phone;
    }

    targetUser.wallet_balance = Number(
      (
        Number(targetUser.wallet_balance || 0) +
        Number(sourceUser.wallet_balance || 0)
      ).toFixed(4),
    );
    targetUser.credit_balance = Number(
      (
        Number(targetUser.credit_balance || 0) +
        Number(sourceUser.credit_balance || 0)
      ).toFixed(2),
    );
    targetUser.frozen_credit = Number(
      (
        Number(targetUser.frozen_credit || 0) +
        Number(sourceUser.frozen_credit || 0)
      ).toFixed(2),
    );

    targetUser.roles = Array.from(
      new Set([...(targetUser.roles || []), ...(sourceUser.roles || [])]),
    );
    targetUser.is_verified = targetUser.is_verified || sourceUser.is_verified;

    await this.orderPort.transferOrders(sourceUser.id, targetUser.id, manager);

    sourceUser.status = 'MERGED';
    sourceUser.merged_into_id = targetUser.id;
    sourceUser.telegram_chat_id = null;
    sourceUser.telegram_username = '';
    sourceUser.wechat_openid = null;
    sourceUser.qq_openid = null;
    sourceUser.phone = null;
    sourceUser.wallet_balance = 0;
    sourceUser.credit_balance = 0;
    sourceUser.frozen_credit = 0;

    await this.usersPort.saveTx(manager, sourceUser);
    return this.usersPort.saveTx(manager, targetUser);
  }
}
