import {
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginResponse } from '../auth.types';
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

  async login(
    user: AuthLoginUserDto,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    const payload = {
      username: user.username,
      sub: user.id,
      roles: user.roles,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.usersPort.addRefreshToken(
      user.id,
      refreshToken,
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
      this.jwtService.verify(refreshToken);
      const tokenRecord =
        await this.usersPort.validateRefreshToken(refreshToken);

      if (!tokenRecord) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = tokenRecord.user;
      const payload = {
        username: user.username,
        sub: user.id,
        roles: user.roles,
      };

      const newAccessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const newRefreshToken = this.jwtService.sign(payload, {
        expiresIn: '7d',
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await this.usersPort.rotateRefreshToken(
        refreshToken,
        newRefreshToken,
        expiresAt,
      );

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(_userId: string, refreshToken: string) {
    await this.usersPort.removeRefreshToken(refreshToken);
    return { success: true };
  }
}
