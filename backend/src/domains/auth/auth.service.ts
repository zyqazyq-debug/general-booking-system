import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { SocialProvider } from './dto/social-login.dto';
import { EntityManager } from 'typeorm';
import { AuthTokenService } from './services/auth-token.service';
import { RegistrationService } from './services/registration.service';
import { SocialAuthService } from './services/social-auth.service';
import { AccountMergeService } from './services/account-merge.service';
import { AuthTelegramLoginService } from './services/auth-telegram-login.service';
import { AuthIdentityService } from './services/auth-identity.service';

import type { AuthLoginUserDto, AuthUserDto } from './dto/auth-user.dto';
import { CreateAuthUserDto } from './dto/create-auth-user.dto';
import type { AuthUsersPort } from './ports/auth-users.port';
import { AUTH_USERS_PORT } from './ports/tokens';
import type {
  BindIdentityProvider,
  BindingStatusResponse,
  LoginResponse,
  ScanIdentityProvider,
} from './auth.types';
import type {
  TelegramAuthData,
  TelegramBotProfile,
} from './interfaces/telegram-validator.interface';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private authTokenService: AuthTokenService,
    private registrationService: RegistrationService,
    private socialAuthService: SocialAuthService,
    private accountMergeService: AccountMergeService,
    private authTelegramLoginService: AuthTelegramLoginService,
    private authIdentityService: AuthIdentityService,
  ) {}

  async validateUser(
    username: string,
    pass: string,
  ): Promise<Omit<AuthUserDto, 'password'> | null> {
    const user = await this.usersPort.findForAuth(username);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      const { password: _password, ...result } = user;
      void _password;
      return result;
    }
    return null;
  }

  async login(
    user: AuthLoginUserDto,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    return this.authTokenService.login(user, deviceInfo);
  }

  async refresh(refreshToken: string) {
    return this.authTokenService.refresh(refreshToken);
  }

  async logout(userId: string, refreshToken: string) {
    return this.authTokenService.logout(userId, refreshToken);
  }

  async register(createUserDto: CreateAuthUserDto) {
    return this.registrationService.register(createUserDto);
  }

  async lightRegister(deviceInfo: Record<string, unknown> = {}) {
    return this.registrationService.lightRegister(deviceInfo);
  }

  async loginWechat(openid: string, deviceInfo: Record<string, unknown> = {}) {
    return this.socialAuthService.loginWechat(openid, deviceInfo);
  }

  async loginQQ(openid: string, deviceInfo: Record<string, unknown> = {}) {
    return this.socialAuthService.loginQQ(openid, deviceInfo);
  }

  async loginPhone(
    phone: string,
    code: string,
    deviceInfo: Record<string, unknown> = {},
  ) {
    return this.authIdentityService.loginPhone(phone, code, deviceInfo);
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
    return this.accountMergeService.mergeTelegramAccount(currentUserId, tgInfo);
  }

  async mergeTelegramAccountWithPhone(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    const mergedUser =
      await this.accountMergeService.mergeTelegramAccountWithPhone(
        currentUserId,
        phone,
        code,
      );
    return this.login(mergedUser);
  }

  async mergeAccountByPhone(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    const mergedUser = await this.accountMergeService.mergeAccountByPhone(
      currentUserId,
      phone,
      code,
    );
    return this.login(mergedUser);
  }

  async bindIdentityOrRequireMerge(
    currentUserId: string,
    provider: BindIdentityProvider,
    identity: string,
    code?: string,
  ) {
    const result = await this.accountMergeService.bindIdentityOrRequireMerge(
      currentUserId,
      provider,
      identity,
      code,
    );
    if (result.status === 'bound') {
      const loginResult = await this.login(result.user);
      return { status: 'bound', ...loginResult };
    }
    return result;
  }

  async performAccountMerge(
    manager: EntityManager,
    sourceUser: AuthUserDto,
    targetUser: AuthUserDto,
  ) {
    return this.accountMergeService.performAccountMerge(
      manager,
      sourceUser,
      targetUser,
    );
  }

  async confirmMergeByIdentity(
    currentUserId: string,
    provider: BindIdentityProvider,
    identity: string,
    code?: string,
  ) {
    const mergedUser = await this.accountMergeService.confirmMergeByIdentity(
      currentUserId,
      provider,
      identity,
      code,
    );
    return this.login(mergedUser);
  }

  async bindPhoneForCurrentUser(
    currentUserId: string,
    phone: string,
    code: string,
  ) {
    const saved = await this.accountMergeService.bindPhoneForCurrentUser(
      currentUserId,
      phone,
      code,
    );
    return this.login(saved);
  }

  async loginTelegram(
    authData: TelegramAuthData,
    deviceInfo: Record<string, unknown> = {},
  ) {
    return this.authTelegramLoginService.loginTelegram(authData, deviceInfo);
  }

  async loginTelegramWebApp(initData: string) {
    return this.authTelegramLoginService.loginTelegramWebApp(initData);
  }

  getSocialProviders() {
    return [
      { provider: SocialProvider.WECHAT, status: 'ready' },
      { provider: SocialProvider.QQ, status: 'ready' },
      { provider: SocialProvider.TELEGRAM, status: 'ready' },
      { provider: SocialProvider.WEIBO, status: 'reserved' },
      { provider: SocialProvider.DOUYIN, status: 'reserved' },
      { provider: SocialProvider.XIAOHONGSHU, status: 'reserved' },
      { provider: SocialProvider.FACEBOOK, status: 'reserved' },
      { provider: SocialProvider.GOOGLE, status: 'reserved' },
      { provider: SocialProvider.APPLE, status: 'reserved' },
    ];
  }

  reserveSocialLogin(provider: SocialProvider, authCode: string) {
    return {
      status: 'reserved',
      provider,
      auth_code: authCode,
      message: `社交登录 ${provider} 已预留接口，待接入官方 OAuth 或开放平台`,
    };
  }

  sendSmsCode(phone: string, scene = 'login') {
    return {
      status: 'reserved',
      phone,
      scene,
      message: '短信验证码发送接口已预留，待接入短信网关',
    };
  }

  async startIdentityScanBinding(
    userId: string,
    provider: ScanIdentityProvider,
  ) {
    return this.authTelegramLoginService.startIdentityScanBinding(
      userId,
      provider,
    );
  }

  async generateTelegramLoginTicket() {
    return this.authTelegramLoginService.generateTelegramLoginTicket();
  }

  async loginByChatId(chatId: string, telegramUser?: TelegramBotProfile) {
    return this.authTelegramLoginService.loginByChatId(chatId, telegramUser);
  }

  checkIdentityScanBindingStatus(ticketId: string): BindingStatusResponse {
    return this.authTelegramLoginService.checkIdentityScanBindingStatus(
      ticketId,
    );
  }

  async unbindIdentity(userId: string, provider: ScanIdentityProvider) {
    return this.authIdentityService.unbindIdentity(userId, provider);
  }
}
