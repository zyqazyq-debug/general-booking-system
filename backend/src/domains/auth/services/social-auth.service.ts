import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuthTokenService } from './auth-token.service';
import type { LoginResponse } from '../auth.types';
import {
  AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT,
  AuthSocialLoginSucceededEvent,
} from '../events/social-login-succeeded.event';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';
import { AUTH_IDENTITY_PROOF_PORT } from '../ports/tokens';
import type { AuthIdentityProofPort } from '../ports/auth-identity-proof.port';

@Injectable()
export class SocialAuthService {
  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private readonly authTokenService: AuthTokenService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(AUTH_IDENTITY_PROOF_PORT)
    private readonly identityProofPort: AuthIdentityProofPort,
  ) {}

  async loginWithVerifiedProof(
    provider: 'wechat' | 'qq',
    proof: string,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    const verified = await this.identityProofPort.consume(proof, provider);
    return provider === 'wechat'
      ? this.loginWechatIdentity(verified.subject, verified.proofId, deviceInfo)
      : this.loginQQIdentity(verified.subject, verified.proofId, deviceInfo);
  }

  private async loginWechatIdentity(
    openid: string,
    proofId: string,
    deviceInfo: Record<string, unknown>,
  ): Promise<LoginResponse> {
    let user = await this.usersPort.findByWechat(openid);
    if (!user) {
      try {
        user = await this.usersPort.createWithProvider({
          username: `wx_${openid.substring(0, 8)}_${Math.random().toString(36).substring(7)}`,
          wechat_openid: openid,
        });
      } catch (error: unknown) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
        const existingByOpenId = await this.usersPort.findByWechatAny(openid);
        if (!existingByOpenId) {
          throw error;
        }
        if (existingByOpenId.status !== 'ACTIVE') {
          throw new UnauthorizedException('Account is not active');
        }
        user = existingByOpenId;
      }
    }
    const response = await this.authTokenService.login(user, deviceInfo);
    const eventPayload: AuthSocialLoginSucceededEvent = {
      eventVersion: 1,
      requestId: randomUUID(),
      proofId,
      provider: 'wechat',
      userId: user.id,
      username: user.username,
      deviceInfo,
      timestamp: new Date().toISOString(),
    };
    this.eventEmitter.emit(AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT, eventPayload);
    return response;
  }

  private async loginQQIdentity(
    openid: string,
    proofId: string,
    deviceInfo: Record<string, unknown>,
  ): Promise<LoginResponse> {
    let user = await this.usersPort.findByQQ(openid);
    if (!user) {
      try {
        user = await this.usersPort.createWithProvider({
          username: `qq_${openid.substring(0, 8)}_${Math.random().toString(36).substring(7)}`,
          qq_openid: openid,
        });
      } catch (error: unknown) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
        const existingByOpenId = await this.usersPort.findByQQAny(openid);
        if (!existingByOpenId) {
          throw error;
        }
        if (existingByOpenId.status !== 'ACTIVE') {
          throw new UnauthorizedException('Account is not active');
        }
        user = existingByOpenId;
      }
    }
    const response = await this.authTokenService.login(user, deviceInfo);
    const eventPayload: AuthSocialLoginSucceededEvent = {
      eventVersion: 1,
      requestId: randomUUID(),
      proofId,
      provider: 'qq',
      userId: user.id,
      username: user.username,
      deviceInfo,
      timestamp: new Date().toISOString(),
    };
    this.eventEmitter.emit(AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT, eventPayload);
    return response;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as { code?: string; message?: string };
    const code = err.code || '';
    const message = err.message || '';
    return (
      code === '23505' ||
      message.includes('duplicate key') ||
      message.includes('UNIQUE constraint failed')
    );
  }
}
