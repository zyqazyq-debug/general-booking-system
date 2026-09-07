import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthUserDto } from './dto/create-auth-user.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { SocialIdentityProofDto } from './dto/social-identity-proof.dto';
import type { TelegramAuthData } from './interfaces/telegram-validator.interface';
import { AppThrottlerGuard } from '../../shared/common/guards/app-throttler.guard';

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
  async telegramLogin(
    @Body() telegramData: TelegramAuthData,
    @Body('deviceInfo') deviceInfo: Record<string, unknown>,
  ) {
    if (!telegramData) {
      throw new UnauthorizedException('Telegram data required');
    }
    return this.authService.loginTelegram(telegramData, deviceInfo);
  }

  @Post('telegram/login-ticket')
  async getTelegramLoginTicket() {
    return this.authService.generateTelegramLoginTicket();
  }

  @Post('telegram/webapp-login')
  async telegramWebAppLogin(@Body('initData') initData: string) {
    this.logger.log(
      `[WebApp Login] Request received. Data length: ${initData?.length}`,
    );
    if (!initData) {
      throw new UnauthorizedException('initData required');
    }
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
