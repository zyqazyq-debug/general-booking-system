import { Update, Ctx, On } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramUiService } from '../services/telegram-ui.service';
import { TelegramPricingApplicationService } from '../../application/telegram-pricing.application.service';

type ReplyMessage = { text?: string; caption?: string };
type TelegramPricingMessage = {
  text?: string;
  reply_to_message?: ReplyMessage;
};

@Update()
export class TelegramPricingUpdate {
  constructor(
    private readonly pricingAppService: TelegramPricingApplicationService,
    private readonly uiService: TelegramUiService,
  ) {}

  @On('text')
  async onText(@Ctx() ctx: Context) {
    const message = ctx.message as TelegramPricingMessage | undefined;
    if (!message || typeof message.text !== 'string') {
      return;
    }
    const userText = message.text.trim();
    if (!userText) return;

    // Only process if it's a reply
    if (!message.reply_to_message) {
      return;
    }

    const replyText = (
      message.reply_to_message.text ||
      message.reply_to_message.caption ||
      ''
    ).trim();
    if (!replyText) return;

    const collectionId =
      await this.pricingAppService.resolveCollectionIdFromReply(replyText);

    if (collectionId) {
      if (this.pricingAppService.isPricingIntent(userText)) {
        await this.uiService.sendEditPrompt(ctx, {
          id: collectionId,
        });
        return;
      }
    }
  }
}
