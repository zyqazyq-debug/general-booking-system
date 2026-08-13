import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';
import type { LoginResponse, ScanIdentityProvider } from '../auth.types';
import { BusinessErrorCode } from '../../../shared/common/exceptions/business-error-code';
import { BusinessException } from '../../../shared/common/exceptions/business.exception';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';

@Injectable()
export class AuthIdentityService {
  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private readonly authTokenService: AuthTokenService,
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

  async loginPhone(
    phone: string,
    code: string,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    this.verifySmsCode(phone, code);
    let user = await this.usersPort.findByPhone(phone);
    if (!user) {
      user = await this.usersPort.createWithProvider({
        username: `ph_${phone.substring(7)}`,
        phone,
      });
    }
    return this.authTokenService.login(user, deviceInfo);
  }

  async unbindIdentity(userId: string, provider: ScanIdentityProvider) {
    const user = await this.usersPort.findOne(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const loginMethods = [
      user.phone,
      user.wechat_openid,
      user.qq_openid,
      user.telegram_chat_id,
      user.email,
    ].filter(Boolean);

    const hasPassword = !!user.password;

    if (loginMethods.length <= 1 && !hasPassword) {
      throw BusinessException.badRequest({
        message:
          '不能解绑唯一的登录凭证。请先绑定其他社交账号或设置手机号/密码。',
        error_code: BusinessErrorCode.LAST_LOGIN_METHOD_REQUIRED,
      });
    }

    if (provider === 'telegram') {
      user.telegram_chat_id = null;
      user.telegram_username = '';
    } else if (provider === 'wechat') {
      user.wechat_openid = null;
    } else if (provider === 'qq') {
      user.qq_openid = null;
    }

    await this.usersPort.save(user);
    return { status: 'success', message: `${provider} 已解绑` };
  }
}
