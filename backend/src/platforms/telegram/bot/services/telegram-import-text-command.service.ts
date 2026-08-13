import { Injectable, Inject } from '@nestjs/common';
import { Context } from 'telegraf';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { CommandParserService } from './command-parser.service';
import { TelegramUiService } from './telegram-ui.service';
import { TelegramMessageParserService } from './telegram-message-parser.service';
import { TelegramImportActionService } from './telegram-import-action.service';
import type { PlatformSystemConfigPort } from '../../../platform-ports';
import { PLATFORM_SYSTEM_CONFIG_PORT } from '../../../platform-ports';

type TelegramMessage = {
  text?: string;
  caption?: string;
  reply_to_message?: {
    text?: string;
    caption?: string;
  };
};

export type TelegramTextInput = {
  normalizedText: string;
  repliedCollectionId: string;
};

@Injectable()
export class TelegramImportTextCommandService {
  constructor(
    private readonly importAppService: TelegramImportApplicationService,
    private readonly commandParser: CommandParserService,
    private readonly uiService: TelegramUiService,
    private readonly messageParser: TelegramMessageParserService,
    private readonly actionService: TelegramImportActionService,
    @Inject(PLATFORM_SYSTEM_CONFIG_PORT)
    private readonly systemConfigPort: PlatformSystemConfigPort,
  ) {}

  private getMessage(ctx: Context): TelegramMessage | undefined {
    return ctx.message as TelegramMessage | undefined;
  }

  private async resolveCollectionId(slugOrId: string): Promise<string> {
    return this.importAppService.resolveCollectionId(slugOrId);
  }

  private async resolveCollectionIdFromReply(
    replyText: string,
  ): Promise<string> {
    const idMatch = replyText.match(/ID[:：]\s*([a-f0-9-]{36})/i);
    if (idMatch) {
      return idMatch[1];
    }
    const slugMatch = replyText.match(/Slug[:：]\s*([a-zA-Z0-9_-]+)/i);
    if (!slugMatch) {
      const commandSlugMatch = replyText.match(/加价\s+([a-zA-Z0-9_-]{6,})/i);
      if (!commandSlugMatch) {
        return '';
      }
      return this.resolveCollectionId(commandSlugMatch[1]);
    }
    return this.resolveCollectionId(slugMatch[1]);
  }

  buildTextInput(ctx: Context): Promise<TelegramTextInput | null> {
    return (async () => {
      const message = this.getMessage(ctx);
      const text = message?.text;
      if (!message || !text || text.startsWith('/')) {
        return null;
      }
      const normalizedText = text.trim();
      const repliedText = (
        message.reply_to_message?.text ||
        message.reply_to_message?.caption ||
        ''
      ).trim();
      const repliedCollectionId = repliedText
        ? await this.resolveCollectionIdFromReply(repliedText)
        : '';
      return { normalizedText, repliedCollectionId };
    })();
  }

  async handleTextInput(params: {
    ctx: Context;
    next: () => Promise<void>;
    input: TelegramTextInput;
    handleImportContent: (ctx: Context, content: string) => Promise<void>;
    handleEditPrice: (
      ctx: Context,
      id: string,
      type: string,
      value: number,
      promptMessageId?: number,
      originalCardMessageId?: number,
    ) => Promise<void>;
  }): Promise<void> {
    const { ctx, next, input, handleImportContent, handleEditPrice } = params;

    if (
      await this.handleMarkupCommand(ctx, input.normalizedText, handleEditPrice)
    ) {
      return;
    }
    if (await this.handlePromoteCommand(ctx, input.normalizedText)) {
      return;
    }
    if (await this.handleReplyCommands(ctx, input, handleEditPrice)) {
      return;
    }
    if (
      await this.handlePendingMarkupInput(
        ctx,
        input.normalizedText,
        handleEditPrice,
      )
    ) {
      return;
    }
    if (this.isPricingShortcutOnReply(input)) {
      return;
    }
    if (await this.handleOrphanMarkupInput(ctx, input)) {
      return;
    }
    if (await this.handleMenuShortcut(next, input.normalizedText)) {
      return;
    }
    if (await this.handleLegacyEditCommand(ctx, input.normalizedText)) {
      return;
    }
    await this.handleImportAsDefault(
      ctx,
      input.normalizedText,
      handleImportContent,
    );
  }

  private async handlePendingMarkupInput(
    ctx: Context,
    normalizedText: string,
    handleEditPrice: (
      ctx: Context,
      id: string,
      type: string,
      value: number,
      promptMessageId?: number,
      originalCardMessageId?: number,
    ) => Promise<void>,
  ): Promise<boolean> {
    const parsed = this.commandParser.parseMarkupCommand(normalizedText, false);
    if (!parsed) {
      return false;
    }
    const pendingTarget = this.actionService.takePendingMarkupTarget(ctx);
    if (!pendingTarget) {
      return false;
    }
    await handleEditPrice(
      ctx,
      pendingTarget.collectionId,
      parsed.markupType,
      parsed.markupValue,
      pendingTarget.promptMessageId,
      pendingTarget.originalCardMessageId,
    );
    return true;
  }

  private async handleMarkupCommand(
    ctx: Context,
    text: string,
    handleEditPrice: (
      ctx: Context,
      id: string,
      type: string,
      value: number,
      promptMessageId?: number,
      originalCardMessageId?: number,
    ) => Promise<void>,
  ): Promise<boolean> {
    const match = text.match(/^加价\s+([a-zA-Z0-9_-]{6,})\s+(.+)$/);
    if (!match) {
      return false;
    }
    const slugOrId = match[1];
    const valueInput = match[2].trim();
    const parsed = this.commandParser.parseMarkupCommand(
      `加价 ${valueInput}`,
      true,
    );
    if (!parsed) {
      await ctx.reply(
        '加价格式不正确，请按以下方式输入：\n加价 abcdefgh 10%\n加价 abcdefgh 30',
      );
      return true;
    }
    const collectionId = await this.resolveCollectionId(slugOrId);
    if (!collectionId) {
      await ctx.reply('未找到对应收藏，请检查 slug 或 ID。');
      return true;
    }
    await handleEditPrice(
      ctx,
      collectionId,
      parsed.markupType,
      parsed.markupValue,
    );
    return true;
  }

  private async handlePromoteCommand(
    ctx: Context,
    text: string,
  ): Promise<boolean> {
    const match = text.match(/^推广\s+([a-zA-Z0-9_-]{6,})$/);
    if (!match) {
      return false;
    }
    const collectionId = await this.resolveCollectionId(match[1]);
    if (!collectionId) {
      await ctx.reply('未找到对应收藏，请检查 slug 或 ID。');
      return true;
    }
    const node = await this.importAppService.findCollectionById(collectionId);
    if (!node) {
      await ctx.reply('未找到该收藏。');
      return true;
    }
    await this.uiService.sendPromoteLink(ctx, node);
    return true;
  }

  private async handleReplyCommands(
    ctx: Context,
    input: TelegramTextInput,
    handleEditPrice: (
      ctx: Context,
      id: string,
      type: string,
      value: number,
      promptMessageId?: number,
      originalCardMessageId?: number,
    ) => Promise<void>,
  ): Promise<boolean> {
    if (!input.repliedCollectionId) {
      return false;
    }
    const replyMarkup = this.commandParser.parseMarkupCommand(
      input.normalizedText,
      false,
    );
    if (replyMarkup) {
      await handleEditPrice(
        ctx,
        input.repliedCollectionId,
        replyMarkup.markupType,
        replyMarkup.markupValue,
      );
      return true;
    }
    if (input.normalizedText !== '推广') {
      return false;
    }
    const node = await this.importAppService.findCollectionById(
      input.repliedCollectionId,
    );
    if (!node) {
      await ctx.reply('未找到该收藏。');
      return true;
    }
    await this.uiService.sendPromoteLink(ctx, node);
    return true;
  }

  private async handleMenuShortcut(
    next: () => Promise<void>,
    normalizedText: string,
  ): Promise<boolean> {
    const normalizedMenuText = normalizedText.replace(/^[🔍⭐👤]\s*/u, '');
    const matched =
      ['🔍 浏览服务', '⭐ 我的收藏', '👤 个人中心'].includes(normalizedText) ||
      ['浏览服务', '我的收藏', '个人中心'].includes(normalizedMenuText);
    if (!matched) {
      return false;
    }
    await next();
    return true;
  }

  private isPricingShortcutOnReply(input: TelegramTextInput): boolean {
    if (!input.repliedCollectionId) return false;
    const normalized = input.normalizedText.trim().toLowerCase();
    return (
      normalized === '加价' ||
      normalized === 'markup' ||
      normalized === '修改加价' ||
      normalized === '修改价格'
    );
  }

  private async handleOrphanMarkupInput(
    ctx: Context,
    input: TelegramTextInput,
  ): Promise<boolean> {
    if (input.repliedCollectionId) return false;
    const parsed = this.commandParser.parseMarkupCommand(
      input.normalizedText,
      false,
    );
    if (!parsed) return false;

    // Safety check: if it looks like a URL, it shouldn't be treated as an orphan markup
    if (
      input.normalizedText.includes('http://') ||
      input.normalizedText.includes('https://')
    ) {
      return false;
    }

    const defaultText = '请先点击收藏卡片的“💰 加价”按钮，再回复数字或百分比。';
    const hintText = await this.systemConfigPort.get<string>(
      'telegram.markup_orphan_input_hint',
      defaultText,
    );
    await ctx.reply(hintText);
    return true;
  }

  private async handleLegacyEditCommand(
    ctx: Context,
    normalizedText: string,
  ): Promise<boolean> {
    if (
      !normalizedText.startsWith('set_price ') &&
      !normalizedText.startsWith('set_percent ') &&
      !normalizedText.startsWith('set_alias ')
    ) {
      return false;
    }
    const parts = normalizedText.split(' ');
    if (parts.length < 2) {
      return false;
    }
    const id = parts[1];
    if (!id.match(/^[a-f0-9-]{36}$/i)) {
      return false;
    }
    await this.uiService.sendEditPrompt(ctx, { id });
    return true;
  }

  private async handleImportAsDefault(
    ctx: Context,
    normalizedText: string,
    handleImportContent: (ctx: Context, content: string) => Promise<void>,
  ): Promise<void> {
    const importInput = this.messageParser.extractImportInput(normalizedText);
    await handleImportContent(ctx, importInput);
  }
}
