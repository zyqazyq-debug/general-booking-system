import { Update, Ctx, On, Action, Next } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';
import { TelegramQrService } from '../services/telegram-qr.service';
import { TelegramErrorNormalizerService } from '../services/telegram-error-normalizer.service';
import { TelegramUiService } from '../services/telegram-ui.service';
import { TelegramMessageParserService } from '../services/telegram-message-parser.service';
import {
  TelegramImportTextCommandService,
  TelegramTextInput,
} from '../services/telegram-import-text-command.service';
import { TelegramImportActionService } from '../services/telegram-import-action.service';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import {
  ImportSource,
  TelegramSessionStateService,
} from '../services/telegram-session-state.service';
import { TelegramCallbackService } from '../services/telegram-callback.service';
import axios from 'axios';

type TelegramPhoto = { file_id: string };
type ReplyMessage = { text?: string; caption?: string };
type TelegramMessage = {
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
  reply_to_message?: ReplyMessage;
};

@Update()
export class TelegramImportUpdate {
  private readonly logger = new Logger(TelegramImportUpdate.name);
  private readonly unrecognizedTextHint =
    '未识别到可处理内容。\n可发送分享链接/二维码，或输入：\n加价 slug 30%\n推广 slug';
  private readonly pendingImportTtlMs = 120000;

  constructor(
    private readonly importAppService: TelegramImportApplicationService,
    private readonly qrService: TelegramQrService,
    private readonly errorNormalizer: TelegramErrorNormalizerService,
    private readonly uiService: TelegramUiService,
    private readonly messageParser: TelegramMessageParserService,
    private readonly textCommandService: TelegramImportTextCommandService,
    private readonly actionService: TelegramImportActionService,
    private readonly sessionState: TelegramSessionStateService,
    private readonly callbackService: TelegramCallbackService,
  ) {}

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const message = this.getMessage(ctx);
    const photo = message?.photo;
    if (!photo || photo.length === 0) return;

    const fileId = photo[photo.length - 1].file_id;
    try {
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await axios.get<ArrayBuffer>(fileLink.href, {
        responseType: 'arraybuffer',
      });
      const buffer = Buffer.from(response.data);
      const qrData = await this.qrService.decodeQrFromBuffer(buffer);

      if (qrData) {
        await this.handleImportContent(ctx, qrData, 'photo_qr');
      } else {
        const caption = message?.caption;
        if (caption) {
          await this.handleImportContent(ctx, caption, 'photo_caption');
          return;
        }

        await this.uiService.sendMainKeyboard(
          ctx,
          '未识别到二维码，请发送清晰的图片。',
        );
      }
    } catch (e) {
      this.logger.error('Failed to process photo', e);
      await this.uiService.sendMainKeyboard(
        ctx,
        '图片处理失败，请确认图片是否清晰。',
      );
    }
  }

  @On('text')
  async onText(@Ctx() ctx: Context, @Next() next: () => Promise<void>) {
    try {
      const input = await this.buildTextInput(ctx);
      if (!input) {
        await next();
        return;
      }
      await this.textCommandService.handleTextInput({
        ctx,
        next,
        input,
        handleImportContent: (ctxArg, content) =>
          this.handleImportContent(ctxArg, content, 'text'),
        handleEditPrice: (
          ctxArg,
          id,
          type,
          value,
          promptMsgId,
          originalCardMsgId,
        ) =>
          this.actionService.handleEditPrice(
            ctxArg,
            id,
            type,
            value,
            promptMsgId,
            originalCardMsgId,
          ),
      });
    } catch (e: unknown) {
      this.logger.error(`Telegram text handler failed: ${String(e)}`);
      await this.uiService.sendMainKeyboard(ctx, '处理失败，请稍后重试。');
    }
  }

  private async handleImportContent(
    ctx: Context,
    content: string,
    source: ImportSource,
  ) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await this.uiService.sendMainKeyboard(ctx, '无法识别当前会话，请重试。');
      return;
    }

    try {
      await ctx.sendChatAction('typing');

      const preCheckResult = await this.importAppService.preCheckImportContent({
        chatId,
        telegramUser: ctx.from,
        content,
      });

      const { action_type, prompt_msg } = preCheckResult;

      if (action_type === 'DEPTH_BLOCKED') {
        await ctx.reply(`❌ ${prompt_msg || '代理层级过多无法导入'}`);
        return;
      }

      if (action_type === 'SAME_PARENT' || action_type === 'SELF_IN_UPSTREAM') {
        const token = this.createPendingImport(
          ctx,
          content,
          source,
          'downstream',
        );
        if (!token) {
          await this.uiService.sendMainKeyboard(
            ctx,
            '无法识别当前会话，请重试。',
          );
          return;
        }

        const inlineKeyboard = [
          [
            { text: '继续新建', callback_data: `confirm_import_${token}` },
            { text: '取消操作', callback_data: `cancel_import_${token}` },
          ],
        ];

        await ctx.reply(`⚠️ ${prompt_msg}`, {
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
        return;
      }

      await this.executeImportContent(ctx, content, source);
    } catch (e: unknown) {
      // Fallback to error handling in executeImportContent if check fails
      this.logger.warn(`Pre-check failed, fallback to execute: ${String(e)}`);
      await this.executeImportContent(ctx, content, source);
    }
  }

  private async executeImportContent(
    ctx: Context,
    content: string,
    source: ImportSource,
    options?: { forceRecreateOnExisting?: boolean; importAsChild?: boolean },
  ) {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await ctx.reply('无法识别当前会话，请重试。');
        return;
      }
      await ctx.sendChatAction('typing');
      const preview = content.substring(0, 24);
      this.logger.log(
        `[TG_IMPORT_INPUT] source=${source} chat=${chatId} user=${ctx.from?.id ?? 'unknown'} content=${preview}`,
      );

      const { fullNode, isNew } = await this.importAppService.importContent({
        chatId,
        telegramUser: ctx.from,
        content,
        forceRecreateOnExisting: options?.forceRecreateOnExisting,
        importAsChild: options?.importAsChild,
      });

      let text = '';
      if (isNew) {
        text = '✅ **已新建收藏**\n已为您成功新建收藏节点。';
      } else {
        text = `✅ **收藏成功**`;
      }

      // Check if service is active.
      // We need to check both AgencyNode status and the underlying Service status.
      // AgencyNode status is ACTIVE by default on creation.
      // Service status is is_active field.
      // We also need to check is_deleted flag.
      const isServiceActive =
        fullNode.service?.is_active && !fullNode.service?.is_deleted;
      const isNodeActive = fullNode.status === 'ACTIVE';

      if (!isNodeActive || !isServiceActive) {
        text += `\n⚠️ **注意**: 该服务当前已下架或暂停，暂时无法预约。`;
      }

      // Check if this is triggered from an inline button (confirmation callback)
      const isEdit = !!ctx.callbackQuery;
      await this.uiService.sendCollectionCard(ctx, fullNode, text, isEdit);
      this.logger.log(
        `[TG_IMPORT_OK] source=${source} chat=${chatId} user=${ctx.from?.id ?? 'unknown'} node=${fullNode.id} isNew=${isNew}`,
      );
    } catch (e: unknown) {
      const errorText = this.errorNormalizer.extractErrorText(e, '');
      const message = this.messageParser.buildImportFailureMessage({
        content,
        errorText,
        queryErrorCode: this.errorNormalizer.extractQueryErrorCode(e),
      });
      this.logger.warn(
        `[TG_IMPORT_ERR] source=${source} chat=${ctx.chat?.id ?? 'unknown'} user=${ctx.from?.id ?? 'unknown'} err=${errorText}`,
      );
      if (!message) {
        await this.uiService.sendMainKeyboard(ctx, this.unrecognizedTextHint);
        return;
      }
      if (message.includes('[object Object]')) {
        this.logger.warn(
          `Filtered [object Object] reply for content: ${content.substring(0, 20)}...`,
        );
        await this.uiService.sendMainKeyboard(ctx, '处理失败，请稍后重试。');
        return;
      }

      this.logger.warn(
        `Import failed for text "${content.substring(0, 20)}...": ${message}`,
      );
      await this.uiService.sendMainKeyboard(ctx, message);
    }
  }

  @Action(/^confirm_import_(.+)$/)
  async onConfirmImport(@Ctx() ctx: Context) {
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const token = match?.[1];
    if (!token) {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '无效请求',
        'import_confirm',
      );
      return;
    }
    const pending = this.takePendingImport(ctx, token);
    if (!pending) {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '请求已过期，请重新发送链接',
        'import_confirm',
      );
      try {
        await ctx.editMessageText('⏳ 导入请求已过期，请重新发送链接。');
      } catch (e: unknown) {
        this.logger.warn(`Failed to edit expired import message: ${String(e)}`);
      }
      return;
    }
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '正在导入...',
      'import_confirm',
    );
    try {
      await ctx.editMessageText('⏳ 正在执行导入，请稍候...');
    } catch (e: unknown) {
      this.logger.warn(`Failed to edit importing message: ${String(e)}`);
    }
    await this.executeImportContent(ctx, pending.content, pending.source, {
      forceRecreateOnExisting: pending.forceRecreateOnExisting,
      importAsChild: pending.importAsChild,
    });
  }

  @Action(/^cancel_import_(.+)$/)
  async onCancelImport(@Ctx() ctx: Context) {
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const token = match?.[1];
    if (!token) {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '无效请求',
        'import_cancel',
      );
      return;
    }
    this.takePendingImport(ctx, token);
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '已取消',
      'import_cancel',
    );
    try {
      await ctx.editMessageText('❌ 已取消本次导入。');
    } catch {
      // ignore
    }
  }

  @Action(/^edit_(.+)$/)
  async onEditAction(@Ctx() ctx: Context) {
    await this.actionService.onEditAction(ctx);
  }

  @Action(/^promote_(.+)$/)
  async onPromoteAction(@Ctx() ctx: Context) {
    await this.actionService.onPromoteAction(ctx);
  }

  @Action(/^markup_(.+)$/)
  async onMarkupAction(@Ctx() ctx: Context) {
    await this.actionService.onMarkupAction(ctx);
  }

  @Action(/^book_([a-f0-9-]+)$/)
  async onBookAction(@Ctx() ctx: Context) {
    await this.actionService.onBookAction(ctx);
  }

  private getMessage(ctx: Context): TelegramMessage | undefined {
    return ctx.message as TelegramMessage | undefined;
  }

  private buildTextInput(ctx: Context): Promise<TelegramTextInput | null> {
    return this.textCommandService.buildTextInput(ctx);
  }

  private createPendingImport(
    ctx: Context,
    content: string,
    source: ImportSource,
    status: 'new' | 'existing' | 'downstream',
  ) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return '';
    }
    return this.sessionState.createPendingImport({
      chatId,
      userId: ctx.from?.id ?? null,
      content,
      source,
      forceRecreateOnExisting: false,
      importAsChild: status === 'existing' || status === 'downstream',
      ttlMs: this.pendingImportTtlMs,
    });
  }

  private takePendingImport(ctx: Context, token: string) {
    return this.sessionState.takePendingImport({
      token,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id ?? null,
    });
  }
}
