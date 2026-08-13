import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

type TelegramInitUser = {
  id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

@Injectable()
export class TelegramWebAppAuthService {
  private readonly logger = new Logger(TelegramWebAppAuthService.name);
  private readonly maxAuthAgeSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>(
      'TELEGRAM_WEBAPP_AUTH_MAX_AGE_SEC',
    );
    const parsed = Number.parseInt(raw || '600', 10);
    this.maxAuthAgeSeconds =
      Number.isFinite(parsed) && parsed >= 60 && parsed <= 86400 ? parsed : 600;
  }

  private isTelegramInitUser(value: unknown): value is TelegramInitUser {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.id === 'string' || typeof candidate.id === 'number';
  }

  /**
   * Validates Telegram WebApp initData and returns parsed data
   */
  validateInitData(initData: string) {
    let params = new URLSearchParams(initData);

    const firstKey = Array.from(params.keys())[0];
    if (
      firstKey &&
      !params.get('hash') &&
      (firstKey.includes('hash=') || firstKey.includes('%'))
    ) {
      try {
        const decoded = decodeURIComponent(initData);
        this.logger.debug(
          `[WebApp Login] Detected over-encoded initData, decoded to: ${decoded.substring(0, 50)}...`,
        );
        params = new URLSearchParams(decoded);
      } catch {
        this.logger.warn(
          '[WebApp Login] initData decode failed, using raw data',
        );
      }
    }

    const hash = params.get('hash');
    const data = Object.fromEntries(params.entries()) as Record<string, string>;
    delete data.hash;

    if (!hash) {
      this.logger.error(
        `[WebApp Login] InitData hash missing. Params keys: ${Object.keys(data).join(',')}`,
      );
      throw new BadRequestException('Invalid initData: hash missing');
    }
    if (!data.auth_date || !data.user) {
      this.logger.error(
        `[WebApp Login] InitData missing required fields. auth_date: ${data.auth_date}, user: ${!!data.user}`,
      );
      throw new BadRequestException(
        'Invalid initData: required fields missing',
      );
    }

    // 核心：直接读取环境变量，本地开发由 .env.local 覆盖
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!botToken || botToken === 'DUMMY') {
      this.logger.error(
        `[WebApp Login] TELEGRAM_BOT_TOKEN is missing or DUMMY. Cannot verify initData.`,
      );
      throw new BadRequestException(
        'Server Error: TELEGRAM_BOT_TOKEN not configured',
      );
    }

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const checkStringA = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');

    const checkStringB = Array.from(params.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const calculatedHashA = crypto
      .createHmac('sha256', secretKey)
      .update(checkStringA)
      .digest('hex');

    const calculatedHashB = crypto
      .createHmac('sha256', secretKey)
      .update(checkStringB)
      .digest('hex');

    if (calculatedHashA !== hash && calculatedHashB !== hash) {
      this.logger.warn(
        `[WebApp Login] Hash mismatch.\n` +
          `Received: ${hash}\n` +
          `Calculated A (decoded): ${calculatedHashA}\n` +
          `Calculated B (raw): ${calculatedHashB}`,
      );
      throw new UnauthorizedException('Invalid Telegram WebApp hash');
    }

    const authDate = parseInt(data.auth_date, 10);
    if (!Number.isFinite(authDate)) {
      throw new BadRequestException('Invalid Telegram auth_date');
    }
    const now = Math.floor(Date.now() / 1000);
    if (authDate - now > 60) {
      throw new UnauthorizedException('Telegram auth data is from future');
    }
    if (now - authDate > this.maxAuthAgeSeconds) {
      throw new UnauthorizedException('Telegram auth data expired');
    }

    let tgUserRaw: unknown;
    try {
      tgUserRaw = JSON.parse(data.user);
    } catch {
      throw new BadRequestException('Invalid Telegram user payload');
    }
    if (!this.isTelegramInitUser(tgUserRaw)) {
      throw new BadRequestException('Invalid Telegram user payload');
    }
    const tgUser = tgUserRaw;

    this.logger.log(
      `[WebApp Login] Successfully verified Telegram user: ${tgUser.id} (@${tgUser.username || 'no_username'})`,
    );

    return {
      telegramId: tgUser.id.toString(),
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      photoUrl: tgUser.photo_url,
      raw: data,
    };
  }
}
