import {
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import type {
  AuthJwtPayload,
  AuthTokenUse,
  LoginResponse,
} from '../auth.types';
import type { AuthLoginUserDto } from '../dto/auth-user.dto';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private readonly jwtService: JwtService,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildPayload(
    user: AuthLoginUserDto,
    tokenUse: AuthTokenUse,
    sessionId: string,
  ): AuthJwtPayload {
    return {
      username: user.username,
      sub: user.id,
      roles: user.roles,
      token_use: tokenUse,
      session_id: sessionId,
      jti: randomUUID(),
      auth_version: user.auth_version,
    };
  }

  async login(
    user: AuthLoginUserDto,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    const sessionId = randomUUID();
    const accessPayload = this.buildPayload(user, 'access', sessionId);
    const refreshPayload = this.buildPayload(user, 'refresh', sessionId);

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '1h',
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '7d',
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.usersPort.addRefreshToken(
      user.id,
      sessionId,
      this.hashToken(refreshToken),
      expiresAt,
      deviceInfo,
    );

    const response: LoginResponse = {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        referral_code: user.referral_code || '',
        email: user.email || '',
        roles: user.roles,
        wallet_balance: user.wallet_balance,
        credit_balance: user.credit_balance,
        frozen_credit: user.frozen_credit,
      },
    };

    this.logger.log(
      `[AuthTokenService] Login success for ${user.username}. Has RefreshToken: ${!!refreshToken}`,
    );
    return response;
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<AuthJwtPayload>(refreshToken);
      if (
        payload.token_use !== 'refresh' ||
        !payload.sub ||
        !payload.session_id ||
        !payload.jti ||
        !Number.isInteger(payload.auth_version)
      ) {
        throw new UnauthorizedException('Invalid refresh token type');
      }
      const oldTokenHash = this.hashToken(refreshToken);
      const tokenRecord = await this.usersPort.validateRefreshToken(
        payload.sub,
        payload.session_id,
        oldTokenHash,
        payload.auth_version,
      );

      if (!tokenRecord) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = tokenRecord.user;
      const newAccessToken = this.jwtService.sign(
        this.buildPayload(user, 'access', tokenRecord.session_id),
        { expiresIn: '1h' },
      );
      const newRefreshToken = this.jwtService.sign(
        this.buildPayload(user, 'refresh', tokenRecord.session_id),
        {
          expiresIn: '7d',
        },
      );

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const rotated = await this.usersPort.rotateRefreshToken(
        tokenRecord.session_id,
        oldTokenHash,
        this.hashToken(newRefreshToken),
        expiresAt,
      );
      if (!rotated) {
        await this.usersPort.revokeSession(user.id, tokenRecord.session_id);
        throw new UnauthorizedException('Refresh token replay detected');
      }

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string) {
    let payload: AuthJwtPayload;
    try {
      payload = this.jwtService.verify<AuthJwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (
      payload.token_use !== 'refresh' ||
      payload.sub !== userId ||
      !payload.session_id ||
      !payload.jti
    ) {
      throw new UnauthorizedException('Refresh token does not match session');
    }
    await this.usersPort.revokeSession(userId, payload.session_id);
    return { success: true };
  }
}
