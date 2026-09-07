import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthUsersPort } from '../../auth';
import type {
  AuthRefreshTokenRecordDto,
  AuthUserDto,
  CreateAuthUserByProviderDto,
  CreatePublicAuthUserPortDto,
} from '../../auth';
import { User } from '../entities/user.entity';
import { UserToken } from '../entities/user-token.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { UsersService } from '../users.service';

@Injectable()
export class AuthUsersAdapter implements AuthUsersPort {
  constructor(private readonly usersService: UsersService) {}

  private toAuthUserDto(user: User): AuthUserDto {
    return {
      id: user.id,
      username: user.username,
      password: user.password ?? null,
      status: user.status as AuthUserDto['status'],
      auth_version: user.auth_version || 1,
      merged_into_id: user.merged_into_id ?? null,
      roles: user.roles || [],
      email: user.email ?? null,
      referral_code: user.referral_code ?? null,
      phone: user.phone ?? null,
      wechat_openid: user.wechat_openid ?? null,
      qq_openid: user.qq_openid ?? null,
      telegram_chat_id: user.telegram_chat_id ?? null,
      telegram_username: user.telegram_username,
      wallet_balance: Number(user.wallet_balance || 0),
      credit_balance: Number(user.credit_balance || 0),
      frozen_credit: Number(user.frozen_credit || 0),
      is_verified: Boolean(user.is_verified),
      nickname: user.nickname,
      avatar: user.avatar,
    };
  }

  private applyAuthUserDtoToEntity(user: User, dto: AuthUserDto) {
    user.username = dto.username;
    if (dto.password) {
      user.password = dto.password;
    }
    user.status = dto.status as unknown as User['status'];
    user.auth_version = dto.auth_version;
    user.merged_into_id = dto.merged_into_id || (null as unknown as string);
    user.roles = dto.roles;
    user.email = dto.email || null;
    user.referral_code = (dto.referral_code || null) as unknown as string;
    user.phone = dto.phone || null;
    user.wechat_openid = dto.wechat_openid || null;
    user.qq_openid = dto.qq_openid || null;
    user.telegram_chat_id = (dto.telegram_chat_id || null) as unknown as string;
    user.telegram_username = dto.telegram_username;
    user.wallet_balance = dto.wallet_balance;
    user.credit_balance = dto.credit_balance;
    user.frozen_credit = dto.frozen_credit;
    user.is_verified = dto.is_verified;
    user.nickname = dto.nickname;
    user.avatar = dto.avatar;
  }

  async findForAuth(username: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findForAuth(username);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findOne(id: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findOne(id);
    return user ? this.toAuthUserDto(user) : null;
  }

  async save(dto: AuthUserDto): Promise<AuthUserDto> {
    const existing = await this.usersService.findOne(dto.id);
    if (!existing) {
      throw new Error('User not found');
    }
    this.applyAuthUserDtoToEntity(existing, dto);
    const saved = await this.usersService.save(existing);
    return this.toAuthUserDto(saved);
  }

  async findByUsername(username: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByUsername(username);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByReferralCode(code: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByReferralCode(code);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByPhone(phone: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByPhone(phone);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByWechat(openid: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByWechat(openid);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByWechatAny(openid: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByWechatAny(openid);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByQQ(openid: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByQQ(openid);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByQQAny(openid: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByQQAny(openid);
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByTelegram(telegramId: string): Promise<AuthUserDto | null> {
    const user = await this.usersService.findByTelegram(telegramId);
    return user ? this.toAuthUserDto(user) : null;
  }

  async create(dto: CreatePublicAuthUserPortDto): Promise<AuthUserDto> {
    const createUserDto: CreateUserDto = dto;
    const user = await this.usersService.create(createUserDto);
    return this.toAuthUserDto(user);
  }

  async createWithProvider(
    dto: CreateAuthUserByProviderDto,
  ): Promise<AuthUserDto> {
    const userData: Partial<User> = {
      username: dto.username,
      nickname: dto.nickname,
      avatar: dto.avatar,
      wechat_openid: dto.wechat_openid,
      qq_openid: dto.qq_openid,
      phone: dto.phone,
      telegram_chat_id: dto.telegram_chat_id,
      telegram_username: dto.telegram_username,
      is_verified: dto.is_verified,
    };
    const user = await this.usersService.createWithProvider(userData);
    return this.toAuthUserDto(user);
  }

  async findOneTx(
    manager: EntityManager,
    id: string,
  ): Promise<AuthUserDto | null> {
    const user = await manager.getRepository(User).findOneBy({ id });
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByPhoneTx(
    manager: EntityManager,
    phone: string,
  ): Promise<AuthUserDto | null> {
    const user = await manager.getRepository(User).findOneBy({ phone });
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByWechatTx(
    manager: EntityManager,
    openid: string,
  ): Promise<AuthUserDto | null> {
    const user = await manager
      .getRepository(User)
      .findOneBy({ wechat_openid: openid });
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByQQTx(
    manager: EntityManager,
    openid: string,
  ): Promise<AuthUserDto | null> {
    const user = await manager
      .getRepository(User)
      .findOneBy({ qq_openid: openid });
    return user ? this.toAuthUserDto(user) : null;
  }

  async findByTelegramTx(
    manager: EntityManager,
    telegramId: string,
  ): Promise<AuthUserDto | null> {
    const user = await manager
      .getRepository(User)
      .findOneBy({ telegram_chat_id: telegramId });
    return user ? this.toAuthUserDto(user) : null;
  }

  async saveTx(manager: EntityManager, dto: AuthUserDto): Promise<AuthUserDto> {
    const repo = manager.getRepository(User);
    const existing = await repo.findOneBy({ id: dto.id });
    if (!existing) {
      throw new Error('User not found');
    }
    this.applyAuthUserDtoToEntity(existing, dto);
    const saved = await repo.save(existing);
    return this.toAuthUserDto(saved);
  }

  addRefreshToken(
    userId: string,
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    deviceInfo: Record<string, unknown>,
  ): Promise<void> {
    return this.usersService
      .addRefreshToken(userId, sessionId, tokenHash, expiresAt, deviceInfo)
      .then(() => undefined);
  }

  async validateRefreshToken(
    userId: string,
    sessionId: string,
    tokenHash: string,
    authVersion: number,
  ): Promise<AuthRefreshTokenRecordDto | null> {
    const record = await this.usersService.validateRefreshToken(
      userId,
      sessionId,
      tokenHash,
      authVersion,
    );
    if (!record) return null;
    return {
      session_id: record.session_id,
      user: this.toAuthUserDto(record.user),
    };
  }

  async validateAccessSession(
    userId: string,
    sessionId: string,
    authVersion: number,
  ): Promise<AuthUserDto | null> {
    const record = await this.usersService.validateAccessSession(
      userId,
      sessionId,
      authVersion,
    );
    return record ? this.toAuthUserDto(record.user) : null;
  }

  async rotateRefreshToken(
    sessionId: string,
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.usersService.rotateRefreshToken(
      sessionId,
      oldTokenHash,
      newTokenHash,
      expiresAt,
    );
  }

  revokeSession(userId: string, sessionId: string): Promise<void> {
    return this.usersService
      .revokeSession(userId, sessionId)
      .then(() => undefined);
  }

  async revokeAllSessionsTx(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await manager
      .getRepository(UserToken)
      .update({ user_id: userId }, { revoked_at: new Date() });
  }
}
