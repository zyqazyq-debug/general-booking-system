import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ITelegramNotificationChannel,
  NotificationDeliveryResult,
} from '../../../../domains/notification';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService implements ITelegramNotificationChannel {
  private readonly logger = new Logger(TelegramService.name);
  private readonly logPath = path.join(
    process.cwd(),
    'logs',
    'telegram-traffic.log',
  );

  constructor(
    @InjectBot() private bot: Telegraf<Context>,
    private readonly configService: ConfigService,
  ) {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private writeTrafficLog(msg: string) {
    const timestamp = new Date().toISOString();
    try {
      fs.appendFileSync(this.logPath, `[${timestamp}] ${msg}\n`, {
        encoding: 'utf8',
      });
    } catch {
      this.logger.warn('Telegram traffic audit log write failed');
    }
  }

  async send(
    recipient: string,
    content: string,
    title?: string,
  ): Promise<NotificationDeliveryResult> {
    const fullMessage = title ? `*${title}*\n\n${content}` : content;
    return this.sendMessage(recipient, fullMessage, {
      parse_mode: 'Markdown',
    });
  }

  async sendMessage(
    chatId: string,
    message: string,
    extra?: Parameters<Telegraf<Context>['telegram']['sendMessage']>[2],
  ): Promise<NotificationDeliveryResult> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (
      process.env.NODE_ENV === 'test' ||
      !token ||
      token === 'DUMMY' ||
      token === 'dummy'
    ) {
      return { outcome: 'failed', errorType: 'ChannelUnavailable' };
    }
    try {
      const response = await this.bot.telegram.sendMessage(
        chatId,
        message,
        extra,
      );
      if (
        !Number.isSafeInteger(response.message_id) ||
        response.message_id < 1
      ) {
        return { outcome: 'uncertain', errorType: 'InvalidProviderReceipt' };
      }
      const logMsg = `📤 [OUT] message delivered (length=${message.length})`;
      this.logger.log(logMsg);
      this.writeTrafficLog(logMsg);
      return {
        outcome: 'sent',
        providerMessageId: String(response.message_id),
      };
    } catch (error: unknown) {
      const result = this.classifyFailure(error);
      const errMsg = `❌ [ERR] Telegram message delivery ${result.outcome}.`;
      this.logger.error(errMsg);
      this.writeTrafficLog(errMsg);
      return result;
    }
  }

  private classifyFailure(error: unknown): NotificationDeliveryResult {
    if (!error || typeof error !== 'object') {
      return { outcome: 'uncertain', errorType: 'UnknownTransportError' };
    }
    const value = error as {
      name?: unknown;
      code?: unknown;
      response?: { error_code?: unknown };
    };
    const providerCode = value.response?.error_code;
    if (
      typeof providerCode === 'number' &&
      Number.isInteger(providerCode) &&
      providerCode >= 400 &&
      providerCode < 500
    ) {
      return {
        outcome: 'failed',
        errorType: `TelegramApi${providerCode}`,
      };
    }
    const code = typeof value.code === 'string' ? value.code : '';
    const name = typeof value.name === 'string' ? value.name : '';
    const timeoutOrDisconnect = new Set([
      'AbortError',
      'ECONNABORTED',
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'TimeoutError',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
    ]);
    if (timeoutOrDisconnect.has(code) || timeoutOrDisconnect.has(name)) {
      return { outcome: 'uncertain', errorType: 'TransportInterrupted' };
    }
    return { outcome: 'uncertain', errorType: 'UnknownTransportError' };
  }

  async getBotInfo() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (
      process.env.NODE_ENV === 'test' ||
      !token ||
      token === 'DUMMY' ||
      token === 'dummy'
    ) {
      return null;
    }
    return await this.bot.telegram.getMe();
  }
}
