import {
  BadRequestException,
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import { CreateAuthUserDto } from '../dto/create-auth-user.dto';
import type { LoginResponse } from '../auth.types';
import { AuthTokenService } from './auth-token.service';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';
import type { AuthUserDto } from '../dto/auth-user.dto';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private readonly authTokenService: AuthTokenService,
  ) {}

  async register(createUserDto: CreateAuthUserDto): Promise<LoginResponse> {
    const existing = await this.usersPort.findByUsername(
      createUserDto.username,
    );
    if (existing) throw new BadRequestException('Username exists');

    let resolvedReferrerId: string | undefined;
    if (createUserDto.referral_code) {
      const referrer = await this.usersPort.findByReferralCode(
        createUserDto.referral_code,
      );
      if (!referrer) {
        throw new BadRequestException('Invalid referral code');
      }
      resolvedReferrerId = referrer.id;
    }

    const user = await this.usersPort.create({
      username: createUserDto.username,
      password: createUserDto.password,
      locale: createUserDto.locale,
      referral_code: createUserDto.referral_code,
      email: createUserDto.email,
      referrer_id: resolvedReferrerId,
      roles: ['CONSUMER'],
    });

    return this.authTokenService.login(user);
  }

  async lightRegister(
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    let user: AuthUserDto | null = null;

    for (let i = 0; i < 5; i++) {
      const username = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        user = await this.usersPort.createWithProvider({
          username,
          nickname: '游客用户',
        });
        break;
      } catch (e: unknown) {
        this.logger.debug(`Retry guest account creation: ${String(e)}`);
      }
    }

    if (!user) {
      throw new BadRequestException('Failed to create lightweight account');
    }

    return this.authTokenService.login(user, deviceInfo);
  }
}
