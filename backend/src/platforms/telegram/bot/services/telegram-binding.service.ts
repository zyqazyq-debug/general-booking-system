import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';

interface BindingTokenInfo {
  userId: string;
  expiresAt: number;
  status: 'pending' | 'success' | 'expired';
  result?: unknown; // Store login result (user + tokens)
}

@Injectable()
export class TelegramBindingService {
  private readonly logger = new Logger(TelegramBindingService.name);
  private readonly tokens = new Map<string, BindingTokenInfo>();
  private readonly TOKEN_TTL = 10 * 60 * 1000; // 10 minutes
  private cachedBotUsername: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  /**
   * Generates a unique binding token for a user
   */
  generateToken(userId: string): string {
    const token = `bt_${crypto.randomBytes(16).toString('hex')}`;
    this.tokens.set(token, {
      userId,
      expiresAt: Date.now() + this.TOKEN_TTL,
      status: 'pending',
    });

    // Cleanup expired tokens occasionally
    this.cleanup();

    return token;
  }

  /**
   * Generates a unique login token for an anonymous user
   */
  generateLoginToken(): string {
    const token = `lt_${crypto.randomBytes(16).toString('hex')}`;
    this.tokens.set(token, {
      userId: '', // Anonymous
      expiresAt: Date.now() + this.TOKEN_TTL,
      status: 'pending',
    });
    this.cleanup();
    return token;
  }

  /**
   * Verifies a binding token and returns the associated userId
   */
  verifyToken(token: string): string | null {
    const info = this.tokens.get(token);
    if (!info || info.status !== 'pending') return null;

    if (Date.now() > info.expiresAt) {
      info.status = 'expired';
      return null;
    }

    return info.userId;
  }

  /**
   * Marks a token as successfully bound/merged
   */
  completeToken(token: string, result?: unknown): void {
    const info = this.tokens.get(token);
    if (info) {
      info.status = 'success';
      info.result = result;
      // Keep for a while so frontend can check status, but set shorter expiry
      info.expiresAt = Date.now() + 60 * 1000;
    }
  }

  /**
   * Checks the status of a token
   */
  getTokenStatus(token: string): {
    status: 'pending' | 'success' | 'expired' | 'not_found';
    result?: unknown;
  } {
    const info = this.tokens.get(token);
    if (!info) return { status: 'not_found' };
    if (Date.now() > info.expiresAt && info.status === 'pending')
      return { status: 'expired' };
    return { status: info.status, result: info.result };
  }

  /**
   * Gets the bot info
   */
  async getBotInfo() {
    try {
      const botMe = await this.bot.telegram.getMe();
      return botMe;
    } catch (e) {
      this.logger.error('Failed to get bot info', e);
      return {
        username:
          this.configService.get<string>('TELEGRAM_BOT_USERNAME') || 'your_bot',
        first_name: '预约系统机器人',
      };
    }
  }

  /**
   * Gets the bot deep link for a token
   */
  async getBotDeepLink(token: string): Promise<string> {
    if (!this.cachedBotUsername) {
      try {
        const botInfo = await this.bot.telegram.getMe();
        this.cachedBotUsername = botInfo.username;
      } catch (e) {
        this.logger.error('Failed to get bot info from telegram', e);
        // Fallback to config or placeholder
        this.cachedBotUsername =
          this.configService.get<string>('TELEGRAM_BOT_USERNAME') || 'your_bot';
      }
    }
    return `https://t.me/${this.cachedBotUsername}?start=${token}`;
  }

  /**
   * Cleans up expired tokens. Listens to the global cleanup event.
   */
  @OnEvent('telegram.tokens.cleanup')
  cleanup() {
    const now = Date.now();
    for (const [token, info] of this.tokens.entries()) {
      if (now > info.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}
