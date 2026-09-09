import { Controller, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { Inject } from '@nestjs/common';
import { Context, Telegraf } from 'telegraf';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import {
  TelegramWebhookClaimOwnershipLostError,
  TelegramWebhookInboxService,
  TelegramWebhookLeaseRenewalError,
} from './persistence/telegram-webhook-inbox.service';

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
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @Inject(getBotToken()) private readonly bot: Telegraf<Context>,
    private readonly configService: ConfigService,
    private readonly inbox: TelegramWebhookInboxService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
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

    const updateId = (req.body as { update_id?: unknown } | undefined)
      ?.update_id;
    if (
      typeof updateId !== 'number' ||
      !Number.isSafeInteger(updateId) ||
      updateId < 0
    ) {
      res.sendStatus(400);
      return;
    }

    let claim: Awaited<ReturnType<TelegramWebhookInboxService['claim']>>;
    try {
      claim = await this.inbox.claim(updateId);
    } catch (error: unknown) {
      this.logFailure('claim_failed', updateId, error);
      res.sendStatus(503);
      return;
    }
    if (claim.kind === 'duplicate') {
      res.sendStatus(200);
      return;
    }
    if (claim.kind === 'in-flight') {
      // A 2xx here could permanently acknowledge an update whose current
      // owner later crashes. Ask Telegram to retry until the durable row is
      // either completed or its lease can be reclaimed.
      res.sendStatus(503);
      return;
    }

    try {
      // Nest owns the response so acknowledgement happens only after the inbox
      // record is durable. Telegraf still exclusively interprets the Update.
      await this.inbox.runWhileRenewingLease(updateId, claim.token, () =>
        this.bot.handleUpdate(
          req.body as Parameters<Telegraf<Context>['handleUpdate']>[0],
        ),
      );
    } catch (error: unknown) {
      const phase =
        error instanceof TelegramWebhookClaimOwnershipLostError
          ? 'claim_ownership_lost'
          : error instanceof TelegramWebhookLeaseRenewalError
            ? 'lease_renewal_failed'
            : 'handler_failed';
      this.logFailure(phase, updateId, error);
      try {
        await this.inbox.release(updateId, claim.token);
      } catch (releaseError: unknown) {
        this.logFailure('release_failed', updateId, releaseError);
      }
      res.sendStatus(500);
      return;
    }

    try {
      await this.inbox.complete(updateId, claim.token);
      res.sendStatus(200);
    } catch (error: unknown) {
      this.logFailure('complete_failed', updateId, error);
      res.sendStatus(503);
    }
  }

  private logFailure(phase: string, updateId: number, error: unknown): void {
    // Only controlled metadata is logged. Error messages/stacks and the raw
    // Telegram Update may contain tokens or user-provided content.
    const errorType =
      error instanceof TelegramWebhookClaimOwnershipLostError
        ? 'ClaimOwnershipLost'
        : error instanceof TelegramWebhookLeaseRenewalError
          ? 'LeaseRenewalError'
          : error instanceof Error
            ? 'Error'
            : 'UnknownError';
    this.logger.error(
      JSON.stringify({
        event: 'telegram_webhook_failed',
        phase,
        update_id: String(updateId),
        error_type: errorType,
      }),
    );
  }
}
