import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type {
  ITelegramValidator,
  TelegramAuthData,
} from '../../../../domains/auth';
import { TelegramWebAppAuthService } from '../../auth/telegram-webapp-auth.service';
import { TelegramBindingService } from './telegram-binding.service';

@Injectable()
export class TelegramValidatorService implements ITelegramValidator {
  constructor(
    private readonly configService: ConfigService,
    private readonly webAppAuthService: TelegramWebAppAuthService,
    private readonly bindingService: TelegramBindingService,
  ) {}

  validateWebAppData(initData: string) {
    return this.webAppAuthService.validateInitData(initData);
  }

  validateBotData(authData: TelegramAuthData): void {
    const { hash, ...data } = authData;

    if (!hash || !data.id || !data.auth_date) {
      throw new BadRequestException('Invalid Telegram auth data');
    }

    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new BadRequestException(`TELEGRAM_BOT_TOKEN not configured`);
    }

    const checkEntries = Object.entries(data).filter(
      (entry): entry is [string, string | number] =>
        entry[0] !== 'hash' &&
        (typeof entry[1] === 'string' || typeof entry[1] === 'number'),
    );
    const checkString = checkEntries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n');

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const hmac = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    if (hmac !== hash) {
      throw new UnauthorizedException('Invalid Telegram hash');
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - data.auth_date > 86400) {
      throw new UnauthorizedException('Telegram auth data expired');
    }
  }

  generateLoginToken(userId?: string): Promise<string> {
    if (userId) {
      return this.bindingService.generateToken(userId);
    }
    return this.bindingService.generateLoginToken();
  }

  async getBotDeepLink(token: string): Promise<string> {
    return this.bindingService.getBotDeepLink(token);
  }

  async getBotInfo(): Promise<{ username: string; first_name: string }> {
    return this.bindingService.getBotInfo();
  }

  getTokenStatus(token: string): Promise<{
    status: 'pending' | 'success' | 'expired' | 'not_found';
    result?: unknown;
  }> {
    return this.bindingService.getTokenStatus(token);
  }
}
