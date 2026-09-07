import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthUserDto } from './dto/create-auth-user.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { SocialIdentityProofDto } from './dto/social-identity-proof.dto';
import { AppThrottlerGuard } from '../../shared/common/guards/app-throttler.guard';
import { TelegramLoginDto } from './dto/telegram-login.dto';
import { TelegramWebAppLoginDto } from './dto/telegram-webapp-login.dto';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class AuthPublicController {
  private readonly logger = new Logger(AuthPublicController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() req: CreateAuthUserDto) {
    return this.authService.register(req);
  }

  @Post('wechat')
  async wechatLogin(@Body() body: SocialIdentityProofDto) {
    return this.authService.loginWithSocialProof(
      'wechat',
      body.proof,
      body.deviceInfo,
    );
  }

  @Post('qq')
  async qqLogin(@Body() body: SocialIdentityProofDto) {
    return this.authService.loginWithSocialProof(
      'qq',
      body.proof,
      body.deviceInfo,
    );
  }

  @Get('social/providers')
  getSocialProviders() {
    return this.authService.getSocialProviders();
  }

  @Post('social/login')
  socialLogin(@Body() body: SocialLoginDto) {
    return this.authService.reserveSocialLogin(body.provider, body.auth_code);
  }

  @Post('telegram')
  async telegramLogin(@Body() telegramData: TelegramLoginDto) {
    return this.authService.loginTelegram(
      telegramData,
      telegramData.deviceInfo,
    );
  }

  @Post('telegram/login-ticket')
  async getTelegramLoginTicket() {
    return this.authService.generateTelegramLoginTicket();
  }

  @Post('telegram/webapp-login')
  async telegramWebAppLogin(@Body() body: TelegramWebAppLoginDto) {
    const { initData } = body;
    this.logger.log(
      `[WebApp Login] Request received. Data length: ${initData?.length}`,
    );
    try {
      const result = await this.authService.loginTelegramWebApp(initData);
      this.logger.log(
        `[WebApp Login] Success for user: ${result.user?.username || 'unknown'}`,
      );
      return result;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.logger.error(`[WebApp Login] Failed: ${error.message}`, error.stack);
      throw e;
    }
  }
}
