import type { EntityManager } from 'typeorm';
import type {
  AuthRefreshTokenRecordDto,
  AuthUserDto,
  CreatePublicAuthUserPortDto,
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

  create(dto: CreatePublicAuthUserPortDto): Promise<AuthUserDto>;
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
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    deviceInfo: Record<string, unknown>,
  ): Promise<void>;
  validateRefreshToken(
    userId: string,
    sessionId: string,
    tokenHash: string,
    authVersion: number,
  ): Promise<AuthRefreshTokenRecordDto | null>;
  validateAccessSession(
    userId: string,
    sessionId: string,
    authVersion: number,
  ): Promise<AuthUserDto | null>;
  rotateRefreshToken(
    sessionId: string,
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  revokeSession(userId: string, sessionId: string): Promise<void>;
  revokeAllSessionsTx(manager: EntityManager, userId: string): Promise<void>;
}
