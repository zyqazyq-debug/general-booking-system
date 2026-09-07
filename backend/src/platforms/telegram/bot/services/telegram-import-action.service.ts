import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { TelegramUiService } from './telegram-ui.service';
import { TelegramErrorNormalizerService } from './telegram-error-normalizer.service';
import { TelegramSessionStateService } from './telegram-session-state.service';
import { TelegramCallbackService } from './telegram-callback.service';

type TelegramActionContext = Context & { match?: string[] };

@Injectable()
export class TelegramImportActionService {
  private readonly logger = new Logger(TelegramImportActionService.name);

  constructor(
    private readonly importAppService: TelegramImportApplicationService,
    private readonly uiService: TelegramUiService,
    private readonly errorNormalizer: TelegramErrorNormalizerService,
    private readonly sessionState: TelegramSessionStateService,
    private readonly callbackService: TelegramCallbackService,
  ) {}

  private getActionId(ctx: Context): string | null {
    const actionContext = ctx as TelegramActionContext;
    if (!actionContext.match || actionContext.match.length < 2) return null;
    return actionContext.match[1];
  }

  setPendingMarkupTarget(ctx: Context, collectionId: string) {
    this.sessionState.setPendingMarkupTarget({
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      collectionId,
      ttlMs: 10 * 60 * 1000,
    });
  }

  takePendingMarkupTarget(ctx: Context) {
    let repliedMessageId: number | undefined;
    if (ctx.message && 'reply_to_message' in ctx.message) {
      repliedMessageId = ctx.message.reply_to_message?.message_id;
    }

    return this.sessionState.takePendingMarkupTarget({
      chatId: ctx.chat?.id,
      userId: ctx.from?.id ?? undefined,
      repliedMessageId,
    });
  }

  async onEditAction(ctx: Context) {
    try {
      const id = this.getActionId(ctx);
      if (!id) return;
      this.logger.log('[TG_ACTION_EDIT]');
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在打开编辑器...',
        'import_action_edit',
      );
      await this.uiService.sendEditPrompt(ctx, { id });
    } catch (e) {
      this.logger.error('Edit action failed', e);
      await ctx.reply('编辑入口暂时不可用，请稍后重试。');
    }
  }

  async onPromoteAction(ctx: Context) {
    try {
      const id = this.getActionId(ctx);
      if (!id) return;
      this.logger.log('[TG_ACTION_PROMOTE]');
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在生成推广链接...',
        'import_action_promote',
      );

      const node = await this.importAppService.findCollectionById(id);
      if (!node) {
        await ctx.reply('未找到该收藏。');
        return;
      }
      await this.uiService.sendPromoteLink(ctx, node);
    } catch (e) {
      this.logger.error('Promote action failed', e);
      await ctx.reply('推广链接生成失败，请稍后重试。');
    }
  }

  async onMarkupAction(ctx: Context) {
    try {
      const id = this.getActionId(ctx);
      if (!id) return;
      this.logger.log('[TG_ACTION_MARKUP]');
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '请在回复框输入加价...',
        'import_action_markup',
      );

      const node = await this.importAppService.findCollectionById(id);
      if (!node) {
        await ctx.reply('未找到该收藏。');
        return;
      }

      const slug = node.share_slug || node.id;
      const samplePercent = `加价 ${slug} 30%`;
      const sampleFixed = `加价 ${slug} 100`;
      const replyMsg = await this.uiService.sendEditPrompt(ctx, node, {
        messageText: `💰 请直接回复本条消息设置加价。\n回复输入：30% 或 100\n示例：${samplePercent}\n示例：${sampleFixed}\nSlug: ${slug}\n\n也可点击下方按钮进入收藏编辑：`,
        buttonText: '✏️ 编辑该收藏',
        replyOptions: {
          reply_markup: {
            force_reply: true,
            input_field_placeholder: `加价 ${slug} 30%`,
          },
        },
      });

      // Save the message_id of the prompt so we can delete it later even if the user doesn't strictly reply to it
      if (replyMsg) {
        this.sessionState.setPendingMarkupTarget({
          chatId: ctx.chat?.id,
          userId: ctx.from?.id,
          collectionId: node.id,
          ttlMs: 300000, // 5 minutes
          promptMessageId: replyMsg.message_id,
          originalCardMessageId: ctx.callbackQuery?.message?.message_id,
        });
      }
    } catch (e) {
      this.logger.error('Markup action failed', e);
      await ctx.reply('加价入口暂时不可用，请检查。');
    }
  }

  async onBookAction(ctx: Context) {
    try {
      const id = this.getActionId(ctx);
      if (!id) return;
      this.logger.log('[TG_ACTION_BOOK]');
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在打开预约...',
        'import_action_book',
      );

      const node = await this.importAppService.findCollectionById(id);
      if (!node) {
        await ctx.reply('未找到该收藏。');
        return;
      }
      await this.uiService.sendBookingPrompt(ctx, node);
    } catch (e) {
      this.logger.error('Book action failed', e);
      await ctx.reply('下单入口暂时不可用，请稍后重试。');
    }
  }

  async handleEditPrice(
    ctx: Context,
    id: string,
    type: string,
    value: number,
    promptMessageId?: number,
    originalCardMessageId?: number,
  ) {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await ctx.reply('无法识别当前会话，请重试。');
        return;
      }
      if (!(value > 0)) {
        await ctx.reply('仅支持正向加价，请输入大于 0 的数字或百分比。');
        return;
      }

      const node = await this.importAppService.updateCollectionMarkup({
        chatId,
        telegramUser: ctx.from,
        collectionId: id,
        markupType: type,
        markupValue: value,
      });

      if (node) {
        // We delete the user's text message if possible
        try {
          if (ctx.message?.message_id) {
            await ctx.deleteMessage(ctx.message.message_id);
          }
        } catch {
          // ignore
        }

        // Try to delete the explicitly saved prompt message
        if (promptMessageId) {
          try {
            await ctx.deleteMessage(promptMessageId);
          } catch {
            // ignore
          }
        }

        // Try to delete the original card message
        if (originalCardMessageId) {
          try {
            await ctx.deleteMessage(originalCardMessageId);
          } catch {
            // ignore
          }
        }

        // We also try to delete the bot's prompt message that the user replied to (fallback)
        try {
          if (
            ctx.message &&
            'reply_to_message' in ctx.message &&
            ctx.message.reply_to_message?.message_id &&
            ctx.message.reply_to_message.message_id !== promptMessageId
          ) {
            await ctx.deleteMessage(ctx.message.reply_to_message.message_id);
          }
        } catch {
          // ignore
        }

        await this.uiService.sendCollectionCard(
          ctx,
          node,
          '✅ **加价修改成功**',
          false, // We send a fresh card at the bottom
        );
        this.logger.log(`[TG_MARKUP_OK] type=${type}`);
      } else {
        await ctx.reply('更新成功，但无法获取最新信息。');
      }
    } catch (e) {
      this.logger.error('Update price failed', e);
      await ctx.reply(
        `更新失败: ${this.errorNormalizer.extractErrorText(e, '请稍后重试')}`,
      );
    }
  }
}
