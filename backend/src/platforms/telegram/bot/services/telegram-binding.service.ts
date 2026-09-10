import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TelegramBindingTicket } from '../../persistence/telegram-binding-ticket.entity';
import {
  decryptTelegramData,
  encryptTelegramData,
} from '../../persistence/telegram-data-encryption';

interface BindingTokenInfo {
  kind: 'login' | 'binding';
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
    @Optional()
    @InjectRepository(TelegramBindingTicket)
    private readonly tickets?: Repository<TelegramBindingTicket>,
  ) {}

  /**
   * Generates a unique binding token for a user
   */
  async generateToken(userId: string): Promise<string> {
    const token = `bt_${crypto.randomBytes(16).toString('hex')}`;
    this.tokens.set(token, {
      kind: 'binding',
      userId,
      expiresAt: Date.now() + this.TOKEN_TTL,
      status: 'pending',
    });
    await this.persistTicket(token, 'binding', userId);

    // Cleanup expired tokens occasionally
    await this.cleanup();

    return token;
  }

  /**
   * Generates a unique login token for an anonymous user
   */
  async generateLoginToken(): Promise<string> {
    const token = `lt_${crypto.randomBytes(16).toString('hex')}`;
    this.tokens.set(token, {
      kind: 'login',
      userId: '', // Anonymous
      expiresAt: Date.now() + this.TOKEN_TTL,
      status: 'pending',
    });
    await this.persistTicket(token, 'login', null);
    await this.cleanup();
    return token;
  }

  /**
   * Verifies a binding token and returns the associated userId
   */
  async verifyToken(token: string): Promise<string | null> {
    const info = await this.loadToken(token);
    if (!info || info.status !== 'pending') return null;

    const now = Date.now();
    if (now >= info.expiresAt) {
      await this.expireAndDelete(token, now);
      return null;
    }

    return info.userId;
  }

  /**
   * Marks a token as successfully bound/merged
   */
  async completeToken(token: string, result?: unknown): Promise<void> {
    const info = await this.loadToken(token);
    const now = Date.now();
    if (!info || info.status !== 'pending') return;
    if (now >= info.expiresAt) {
      await this.expireAndDelete(token, now);
      return;
    }
    const expiresAt = now + 60 * 1000;
    if (this.tickets) {
      const update = await this.tickets.update(
        {
          token_hash: this.hashToken(token),
          status: 'pending',
          expires_at: MoreThan(new Date(now)),
        },
        {
          status: 'success',
          result_payload:
            result === undefined ? null : this.encryptResult(result, token),
          expires_at: new Date(expiresAt),
        },
      );
      if (update.affected !== 1) {
        this.tokens.delete(token);
        return;
      }
    }
    info.status = 'success';
    info.result = result;
    info.expiresAt = expiresAt;
  }

  /**
   * Checks the status of a token
   */
  async getTokenStatus(
    token: string,
    consumeSuccess = true,
  ): Promise<{
    status: 'pending' | 'success' | 'expired' | 'not_found';
    result?: unknown;
  }> {
    if (this.tickets) {
      return this.getPersistentTokenStatus(token, consumeSuccess);
    }
    const info = this.tokens.get(token);
    if (!info) return { status: 'not_found' };
    if (Date.now() >= info.expiresAt) {
      this.tokens.delete(token);
      return { status: 'expired' };
    }
    if (consumeSuccess && info.status === 'success') {
      const result = info.result;
      info.status = 'expired';
      info.result = undefined;
      return { status: 'success', result };
    }
    return { status: info.status, result: info.result };
  }

  async getLoginTokenStatus(token: string) {
    if (this.tickets) {
      return this.getPersistentTokenStatus(token, true, 'login');
    }
    const info = this.tokens.get(token);
    if (!info || info.kind !== 'login') return { status: 'not_found' as const };
    return this.getTokenStatus(token);
  }

  async getBindingTokenStatus(token: string, userId: string) {
    if (this.tickets) {
      return this.getPersistentTokenStatus(token, true, 'binding', userId);
    }
    const info = this.tokens.get(token);
    if (!info || info.kind !== 'binding' || info.userId !== userId) {
      return { status: 'not_found' as const };
    }
    return this.getTokenStatus(token);
  }

  async peekTokenStatus(token: string) {
    return this.getTokenStatus(token, false);
  }

  /**
   * Gets the bot info
   */
  async getBotInfo() {
    try {
      const botMe = await this.bot.telegram.getMe();
      return botMe;
    } catch {
      this.logger.error('Failed to get bot info.');
      return {
        username: this.configuredBotUsername(),
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
      } catch {
        this.logger.error('Failed to get bot info from Telegram.');
        // Fallback to config or placeholder
        this.cachedBotUsername = this.configuredBotUsername();
      }
    }
    return `https://t.me/${this.cachedBotUsername}?start=${token}`;
  }

  private configuredBotUsername(): string {
    return (
      this.configService.get<string>('TELEGRAM_BOT_USERNAME') ||
      this.configService.get<string>('TELEGRAM_BOT_NAME') ||
      'your_bot'
    );
  }

  /**
   * Cleans up expired tokens. Listens to the global cleanup event.
   */
  @OnEvent('telegram.tokens.cleanup')
  async cleanup() {
    const now = Date.now();
    for (const [token, info] of this.tokens.entries()) {
      if (now > info.expiresAt) {
        this.tokens.delete(token);
      }
    }
    if (this.tickets) {
      await this.tickets.delete({ expires_at: LessThanOrEqual(new Date(now)) });
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async persistTicket(
    token: string,
    kind: 'login' | 'binding',
    userId: string | null,
  ): Promise<void> {
    if (!this.tickets) return;
    const info = this.tokens.get(token);
    if (!info) return;
    await this.tickets.insert({
      token_hash: this.hashToken(token),
      kind,
      user_id: userId,
      status: info.status,
      result_payload: null,
      expires_at: new Date(info.expiresAt),
    });
  }

  private async loadToken(
    token: string,
  ): Promise<BindingTokenInfo | undefined> {
    const cached = this.tokens.get(token);
    if (cached) return cached;
    if (!this.tickets) return undefined;
    const ticket = await this.tickets.findOneBy({
      token_hash: this.hashToken(token),
    });
    if (!ticket) return undefined;
    const info: BindingTokenInfo = {
      kind: ticket.kind,
      userId: ticket.user_id || '',
      expiresAt: ticket.expires_at.getTime(),
      status: ticket.status,
      result: ticket.result_payload
        ? this.decryptResult(ticket.result_payload, token)
        : undefined,
    };
    this.tokens.set(token, info);
    return info;
  }

  private async expireAndDelete(token: string, now: number) {
    this.tokens.delete(token);
    if (this.tickets) {
      await this.tickets.delete({
        token_hash: this.hashToken(token),
        expires_at: LessThanOrEqual(new Date(now)),
      });
    }
  }

  private async getPersistentTokenStatus(
    token: string,
    consumeSuccess: boolean,
    expectedKind?: 'login' | 'binding',
    expectedUserId?: string,
  ): Promise<{
    status: 'pending' | 'success' | 'expired' | 'not_found';
    result?: unknown;
  }> {
    const tokenHash = this.hashToken(token);
    const identity = {
      token_hash: tokenHash,
      ...(expectedKind ? { kind: expectedKind } : {}),
      ...(expectedUserId ? { user_id: expectedUserId } : {}),
    };
    const ticket = await this.tickets!.findOneBy(identity);
    if (!ticket) {
      this.tokens.delete(token);
      return { status: 'not_found' };
    }
    const now = Date.now();
    if (now >= ticket.expires_at.getTime()) {
      await this.expireAndDelete(token, now);
      return { status: 'expired' };
    }
    if (ticket.status === 'expired') {
      this.tokens.set(token, {
        kind: ticket.kind,
        userId: ticket.user_id || '',
        expiresAt: ticket.expires_at.getTime(),
        status: 'expired',
      });
      return { status: 'expired' };
    }
    if (ticket.status === 'success' && consumeSuccess) {
      const result = ticket.result_payload
        ? this.decryptResult(ticket.result_payload, token)
        : undefined;
      const consumed = await this.tickets!.update(
        {
          token_hash: tokenHash,
          ...(expectedKind ? { kind: expectedKind } : {}),
          ...(expectedUserId ? { user_id: expectedUserId } : {}),
          status: 'success',
          expires_at: MoreThan(new Date(now)),
        },
        { status: 'expired', result_payload: null },
      );
      if (consumed.affected !== 1) {
        this.tokens.delete(token);
        return { status: 'expired' };
      }
      this.tokens.set(token, {
        kind: ticket.kind,
        userId: ticket.user_id || '',
        expiresAt: ticket.expires_at.getTime(),
        status: 'expired',
      });
      return { status: 'success', result };
    }
    const info: BindingTokenInfo = {
      kind: ticket.kind,
      userId: ticket.user_id || '',
      expiresAt: ticket.expires_at.getTime(),
      status: ticket.status,
      result: ticket.result_payload
        ? this.decryptResult(ticket.result_payload, token)
        : undefined,
    };
    this.tokens.set(token, info);
    return { status: info.status, result: info.result };
  }

  private encryptResult(result: unknown, token: string): string {
    return encryptTelegramData(
      result,
      this.hashToken(token),
      this.configService,
    );
  }

  private decryptResult(payload: string, token: string): unknown {
    return decryptTelegramData(
      payload,
      this.hashToken(token),
      this.configService,
    );
  }
}
