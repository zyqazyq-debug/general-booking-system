import type { EntityManager } from 'typeorm';
import type { CreateAuthUserDto } from '../dto/create-auth-user.dto';
import type {
  AuthRefreshTokenRecordDto,
  AuthUserDto,
  CreateAuthUserByProviderDto,
} from '../dto/auth-user.dto';

export interface AuthUsersPort {
  findForAuth(username: string): Promise<AuthUserDto | null>;

  findOne(id: string): Promise<AuthUserDto | null>;
  save(user: AuthUserDto): Promise<AuthUserDto>;

  findByUsername(username: string): Promise<AuthUserDto | null>;
  findByReferralCode(code: string): Promise<AuthUserDto | null>;

  findByPhone(phone: string): Promise<AuthUserDto | null>;
  findByWechat(openid: string): Promise<AuthUserDto | null>;
  findByWechatAny(openid: string): Promise<AuthUserDto | null>;
  findByQQ(openid: string): Promise<AuthUserDto | null>;
  findByQQAny(openid: string): Promise<AuthUserDto | null>;
  findByTelegram(telegramId: string): Promise<AuthUserDto | null>;

  create(dto: CreateAuthUserDto): Promise<AuthUserDto>;
  createWithProvider(dto: CreateAuthUserByProviderDto): Promise<AuthUserDto>;

  findOneTx(manager: EntityManager, id: string): Promise<AuthUserDto | null>;
  findByPhoneTx(
    manager: EntityManager,
    phone: string,
  ): Promise<AuthUserDto | null>;
  findByWechatTx(
    manager: EntityManager,
    openid: string,
  ): Promise<AuthUserDto | null>;
  findByQQTx(
    manager: EntityManager,
    openid: string,
  ): Promise<AuthUserDto | null>;
  findByTelegramTx(
    manager: EntityManager,
    telegramId: string,
  ): Promise<AuthUserDto | null>;
  saveTx(manager: EntityManager, user: AuthUserDto): Promise<AuthUserDto>;

  addRefreshToken(
    userId: string,
    token: string,
    expiresAt: Date,
    deviceInfo: Record<string, unknown>,
  ): Promise<void>;
  validateRefreshToken(
    token: string,
  ): Promise<AuthRefreshTokenRecordDto | null>;
  rotateRefreshToken(
    oldToken: string,
    newToken: string,
    expiresAt: Date,
  ): Promise<void>;
  removeRefreshToken(token: string): Promise<void>;
}
