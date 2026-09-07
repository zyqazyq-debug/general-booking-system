/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';
import type { PlatformAgencyNodeDto } from '../../../platform-ports';

@Injectable()
export class TelegramUiService {
  private h5BaseUrl: string;
  private readonly logger = new Logger(TelegramUiService.name);

  constructor(private readonly configService: ConfigService) {
    // 逻辑：直接读取环境变量，本地开发由 .env.local 覆盖
    this.h5BaseUrl = this.configService.get<string>('H5_URL') || '';

    if (!this.h5BaseUrl) {
      throw new Error(
        `Telegram H5 base URL is not configured. Set H5_URL in .env`,
      );
    }

    this.h5BaseUrl = this.h5BaseUrl.replace(/\/$/, '');

    this.logger.log(
      `[Config] Telegram UI Service initialized. BaseURL: ${this.h5BaseUrl}`,
    );
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()`]/g, '\\$&');
  }

  async sendMainKeyboard(ctx: Context, message: any) {
    const homeUrl = `${this.h5BaseUrl}/#/pages/index/index`;
    const createUrl = `${this.h5BaseUrl}/#/pages/provider/dashboard/index`;
    const libraryUrl = `${this.h5BaseUrl}/#/pages/library/index`;
    const orderUrl = `${this.h5BaseUrl}/#/pages/order/manage`;
    const profileUrl = `${this.h5BaseUrl}/#/pages/user/profile?action=profile`;
    const referralUrl = `${this.h5BaseUrl}/#/pages/user/profile?action=referral`; // Custom action for profile to open referral

    // Ensure message is a string to avoid [object Object]
    const rawText =
      typeof message === 'string'
        ? message
        : typeof message === 'object'
          ? JSON.stringify(message, null, 2)
          : String(message);
    // Escape raw text to prevent Markdown parsing errors
    const text = rawText.trim()
      ? this.escape(rawText)
      : '欢迎使用通用预约系统，请选择下方功能开始使用。';

    this.logger.debug('[TelegramUi] Sending main keyboard.');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ 发布日程', web_app: { url: createUrl } },
            { text: '📥 导入收藏', web_app: { url: libraryUrl } },
          ],
          [
            { text: '📅 日程管理', web_app: { url: orderUrl } },
            { text: '📈 分享回馈', web_app: { url: referralUrl } },
          ],
        ],
      },
    });

    // Also send/update the persistent bottom keyboard
    await ctx.reply('已为你更新底部菜单，请直接点击使用。', {
      reply_markup: {
        keyboard: [
          [
            { text: '🛎 服务', web_app: { url: homeUrl } },
            { text: '⭐ 收藏', web_app: { url: libraryUrl } },
            { text: '👤 个人中心', web_app: { url: profileUrl } },
          ],
        ],
        resize_keyboard: true,
        is_persistent: true,
      },
    });
  }

  async sendCollectionCard(
    ctx: Context,
    node: PlatformAgencyNodeDto,
    header?: string,
    isEdit = false,
  ) {
    const text = header
      ? `${header}\n\n${this.buildCollectionCardMessage(node)}`
      : this.buildCollectionCardMessage(node);
    const bookingUrl = `${this.h5BaseUrl}/#/pages/booking/detail?slug=${node.share_slug}`;

    const options = {
      parse_mode: 'Markdown' as const,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 加价', callback_data: `markup_${node.id}` },
            { text: '📢 推广', callback_data: `promote_${node.id}` },
            { text: '📅 预定', web_app: { url: bookingUrl } },
          ],
        ],
      },
    };

    if (isEdit && ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, options);
      } catch {
        // If edit fails (e.g., content exactly the same), fallback to reply
        await ctx.reply(text, options);
      }
    } else {
      await ctx.reply(text, options);
    }
  }

  async sendPromoteLink(ctx: Context, node: PlatformAgencyNodeDto) {
    const title = this.escape(node.alias || node.service?.title || '服务');
    const duration = node.service?.duration_minutes ?? '--';
    const priceText = `¥${node.cache_total_price}`;
    const promoteUrl = `${this.h5BaseUrl}/#/pages/booking/detail?slug=${node.share_slug}`;
    const botName = this.configService.get<string>('TELEGRAM_BOT_NAME') || '';
    const webAppShortName =
      this.configService.get<string>('TELEGRAM_WEBAPP_SHORT_NAME') ||
      'bookingdev'; // Default to dev short name
    const botLink = botName
      ? `https://t.me/${botName}/${webAppShortName}?startapp=${encodeURIComponent(`ic_${node.share_slug}`)}`
      : '';
    const botStartLink = botName
      ? `https://t.me/${botName}?start=${encodeURIComponent(`ic_${node.share_slug}`)}`
      : '';

    const directLinkText = botLink ? `[👉 直达WebApp](${botLink})` : '未配置';
    const botStartLinkText = botStartLink
      ? `[👉 唤起机器人](${botStartLink})`
      : '未配置';

    await ctx.reply(
      `✅ *推广内容已生成*\n📦 ${title}\n💰 价格: ${priceText}\n⏳ 时长: ${duration}分钟\n\n` +
        `🧪 **测试入口（三合一）**：\n` +
        `1️⃣ **WebApp直连** (Direct Link):\n${directLinkText}\n` +
        `2️⃣ **机器人唤起** (Start Payload):\n${botStartLinkText}\n` +
        `3️⃣ **外部链接** (复制分享):\n\`${promoteUrl}\``,
      {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 WebApp直连', web_app: { url: promoteUrl } }],
            ...(botStartLink
              ? [[{ text: '🤖 机器人唤起', url: botStartLink }]]
              : []),
            [{ text: '🌐 外部链接', url: promoteUrl }],
          ],
        },
      },
    );
  }

  async sendEditPrompt(
    ctx: Context,
    node: Pick<PlatformAgencyNodeDto, 'id'>,
    options?: {
      messageText?: string;
      buttonText?: string;
      replyOptions?: any;
    },
  ) {
    const libraryUrl = `${this.h5BaseUrl}/#/pages/library/index?editId=${encodeURIComponent(node.id)}`;
    const messageText = options?.messageText || '请在小程序中管理收藏：';
    const buttonText = options?.buttonText || '✏️ 打开收藏夹';

    // Check if the caller explicitly provided inline_keyboard in replyOptions
    let inlineKeyboard = [[{ text: buttonText, web_app: { url: libraryUrl } }]];

    if (options?.replyOptions?.reply_markup?.inline_keyboard) {
      inlineKeyboard = [
        ...options.replyOptions.reply_markup.inline_keyboard,
        [{ text: buttonText, web_app: { url: libraryUrl } }],
      ];
    }

    const replyMarkup = {
      ...options?.replyOptions?.reply_markup,
      inline_keyboard: inlineKeyboard,
    };

    return await ctx.reply(messageText, {
      ...options?.replyOptions,
      reply_markup: replyMarkup,
    });
  }

  async sendBookingPrompt(
    ctx: Context,
    node: Pick<PlatformAgencyNodeDto, 'share_slug'>,
  ) {
    const detailUrl = `${this.h5BaseUrl}/#/pages/booking/detail?slug=${node.share_slug}`;
    await ctx.reply('请在小程序中预约：', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 立即预约', web_app: { url: detailUrl } }],
        ],
      },
    });
  }

  private buildCollectionCardMessage(node: PlatformAgencyNodeDto): string {
    const title = this.escape(node.alias || node.service?.title || '服务');
    const duration = node.service?.duration_minutes ?? '--';
    const totalPrice = Number(node.cache_total_price || 0);
    const markupAmount = Number(node.markup_amount || 0);
    const basePrice =
      Number(node.cache_cost_price || 0) || Number(totalPrice - markupAmount);
    const priceText = `¥${totalPrice} = ¥${basePrice} + ¥${markupAmount}`;

    // Add markup info if exists
    let markupInfo = '';
    if (markupAmount > 0) {
      const typeStr = node.markup_type === 'PERCENT' ? '%' : '元';
      markupInfo = `\n💰 加价: ${node.markup_value}${typeStr} (¥${markupAmount})`;
    }

    return (
      `📦 **${title}**\n` +
      `💰 价格: ${priceText}${markupInfo}\n` +
      `⏳ 时长: ${duration}分钟\n` +
      `🔗 Slug: \`${node.share_slug}\`\n\n` +
      `👇 点击下方按钮可直接加价、推广或预定:`
    );
  }
}
