import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { Inject } from '@nestjs/common';
import { Context, Telegraf } from 'telegraf';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function hasMatchingSecret(expected: string, supplied: string | undefined) {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    @Inject(getBotToken()) private readonly bot: Telegraf<Context>,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    const webhookEnabled =
      this.configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true' &&
      this.configService.get<string>('TELEGRAM_BOT_MODE')?.toLowerCase() ===
        'webhook';
    const secret = this.configService.get<string>(
      'TELEGRAM_WEBHOOK_SECRET_TOKEN',
    );

    if (!webhookEnabled || !secret || !SECRET_TOKEN_PATTERN.test(secret)) {
      res.sendStatus(503);
      return;
    }

    const headerValue = req.headers[SECRET_HEADER];
    const supplied = Array.isArray(headerValue) ? undefined : headerValue;
    if (!hasMatchingSecret(secret, supplied)) {
      res.sendStatus(403);
      return;
    }

    const callback = this.bot.webhookCallback(WEBHOOK_PATH, {
      secretToken: secret,
    });
    await callback(req, res);
  }
}
