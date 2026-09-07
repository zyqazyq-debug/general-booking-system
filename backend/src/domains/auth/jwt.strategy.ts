import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../shared/common/types/auth-request.type';
import type { AuthJwtPayload } from './auth.types';
import type { AuthUsersPort } from './ports/auth-users.port';
import { AUTH_USERS_PORT } from './ports/tokens';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
  ) {
    const activeIndex =
      configService.get<string>('JWT_SECRET_ACTIVE_INDEX') || '1';
    const secret1 = configService.get<string>('JWT_SECRET1');
    const secret2 = configService.get<string>('JWT_SECRET2');

    const secret =
      activeIndex === '2'
        ? secret2
        : secret1 || configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET is not defined in JwtStrategy');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: AuthJwtPayload): Promise<AuthenticatedUser> {
    if (
      !payload.sub ||
      !payload.username ||
      payload.token_use !== 'access' ||
      !payload.session_id ||
      !payload.jti ||
      !Number.isInteger(payload.auth_version)
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }
    const currentUser = await this.usersPort.validateAccessSession(
      payload.sub,
      payload.session_id,
      payload.auth_version,
    );
    if (!currentUser) {
      throw new UnauthorizedException('Session is not active');
    }
    return {
      id: currentUser.id,
      username: currentUser.username,
      roles: currentUser.roles || [],
    };
  }
}
