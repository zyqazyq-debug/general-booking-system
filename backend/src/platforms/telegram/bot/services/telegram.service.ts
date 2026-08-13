import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import type { ITelegramNotificationChannel } from '../../../../domains/notification';

@Injectable()
export class TelegramService implements ITelegramNotificationChannel {
  private readonly logger = new Logger(TelegramService.name);
  private readonly logPath = path.join(
    process.cwd(),
    'logs',
    'telegram-traffic.log',
  );

  constructor(@InjectBot() private bot: Telegraf<Context>) {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private writeTrafficLog(msg: string) {
    const timestamp = new Date().toISOString();
    // Use UTF-8 encoding for file append
    fs.appendFileSync(this.logPath, `[${timestamp}] ${msg}\n`, {
      encoding: 'utf8',
    });
  }

  async send(
    recipient: string,
    content: string,
    title?: string,
  ): Promise<boolean> {
    const fullMessage = title ? `*${title}*\n\n${content}` : content;
    try {
      await this.sendMessage(recipient, fullMessage, {
        parse_mode: 'Markdown',
      });
      return true;
    } catch {
      return false;
    }
  }

  async sendMessage(chatId: string, message: string, extra?: any) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (
      process.env.NODE_ENV === 'test' ||
      !token ||
      token === 'DUMMY' ||
      token === 'dummy'
    ) {
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await this.bot.telegram.sendMessage(chatId, message, extra);
      const logMsg = `📤 [OUT] to ${chatId} | Text: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`;
      this.logger.log(logMsg);
      this.writeTrafficLog(logMsg);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      const errMsg = `❌ [ERR] Failed to send message to ${chatId}: ${error.message}`;
      this.logger.error(errMsg, error.stack);
      this.writeTrafficLog(errMsg);
    }
  }

  async getBotInfo() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
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
