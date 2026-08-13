import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramErrorNormalizerService } from './telegram-error-normalizer.service';

@Injectable()
export class TelegramCallbackService {
  private readonly logger = new Logger(TelegramCallbackService.name);

  constructor(
    private readonly errorNormalizer: TelegramErrorNormalizerService,
  ) {}

  async answerCbQuerySafely(ctx: Context, text?: string, scene = 'default') {
    try {
      await ctx.answerCbQuery(text);
    } catch (e) {
      const message = this.errorNormalizer.extractErrorText(e, '');
      if (
        /query is too old|query id is invalid|query is too old and response timeout expired|timeout/i.test(
          message,
        )
      ) {
        this.logger.warn(
          `[TG_CALLBACK_EXPIRED] scene=${scene} chat=${ctx.chat?.id ?? 'unknown'} user=${ctx.from?.id ?? 'unknown'} msg=${message}`,
        );
        return;
      }
      throw e;
    }
  }
}
