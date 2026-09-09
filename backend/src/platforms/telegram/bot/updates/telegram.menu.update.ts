import { Update, Ctx, Start, Command, Hears, Action } from 'nestjs-telegraf';
import { Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';
import { TelegramBindingApplicationService } from '../../application/telegram-binding.application.service';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { TelegramUiService } from '../services/telegram-ui.service';
import { TelegramErrorNormalizerService } from '../services/telegram-error-normalizer.service';
import { TelegramMessageParserService } from '../services/telegram-message-parser.service';
import { TelegramAuthService } from '../services/telegram-auth.service';
import { TelegramCallbackService } from '../services/telegram-callback.service';
import {
  TelegramMutationReplayBlockedError,
  TELEGRAM_MUTATION_REPLAY_MESSAGE,
  TelegramWebhookMutationFenceService,
} from '../../persistence/telegram-webhook-mutation-fence.service';

import type {
  PlatformSystemConfigPort,
  PlatformUsersPort,
} from '../../../platform-ports';
import {
  PLATFORM_SYSTEM_CONFIG_PORT,
  PLATFORM_USERS_PORT,
} from '../../../platform-ports';

interface ExtendedContext extends Context {
  startPayload?: string;
  match?: RegExpExecArray | string[] | null;
}

@Update()
export class TelegramMenuUpdate {
  private readonly logger = new Logger(TelegramMenuUpdate.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(PLATFORM_SYSTEM_CONFIG_PORT)
    private readonly systemConfigPort: PlatformSystemConfigPort,
    private readonly bindingAppService: TelegramBindingApplicationService,
    private readonly importAppService: TelegramImportApplicationService,
    private readonly errorNormalizer: TelegramErrorNormalizerService,
    private readonly messageParser: TelegramMessageParserService,
    private readonly authService: TelegramAuthService,
    @Inject(PLATFORM_USERS_PORT)
    private readonly usersPort: PlatformUsersPort,
    private readonly uiService: TelegramUiService,
    private readonly callbackService: TelegramCallbackService,
    @Optional()
    private readonly mutationFence?: TelegramWebhookMutationFenceService,
  ) {}

  @Start()
  async start(@Ctx() ctx: ExtendedContext) {
    const user = ctx.from;
    const chat = ctx.chat;
    if (!user || !chat) return;

    const chatId = chat.id;
    const startPayload = ctx.startPayload;

    if (startPayload && startPayload.startsWith('bt_')) {
      await this.handleBindingToken(ctx, startPayload);
      return;
    }

    if (startPayload && startPayload.startsWith('lt_')) {
      await this.handleLoginToken(ctx, startPayload);
      return;
    }

    if (startPayload && startPayload.startsWith('ic_')) {
      await this.handleImportStartPayload(ctx, startPayload.slice(3));
      return;
    }
    if (startPayload && startPayload.startsWith('rf_')) {
      await this.handleReferralStartPayload(ctx, startPayload.slice(3));
      return;
    }

    this.logger.log('Received /start command.');

    try {
      // 优先从数据库配置表读取，若无则回退到默认文案
      const defaultMessage = `👋 你好，${user.first_name}！\n欢迎使用通用预约系统。\n\n请选择下方功能开始使用：`;
      const messageText = await this.systemConfigPort.get<string>(
        'telegram.welcome_message',
        defaultMessage,
      );

      // 支持简单的模版变量替换 (简单的 {{name}} 替换)
      const finalMessage = messageText.replace(
        /{{name}}/g,
        user.first_name || '用户',
      );

      await this.uiService.sendMainKeyboard(ctx, finalMessage);
    } catch {
      this.logger.error('Failed to handle /start.');
    }
  }

  // Deprecated handlers - Reply with redirect hint
  @Hears(/^(?:📦\s*)?我的服务\s*$/)
  async listMyServices(@Ctx() ctx: ExtendedContext) {
    await this.uiService.sendMainKeyboard(
      ctx,
      '功能已迁移至小程序，体验更佳！',
    );
  }

  @Hears(/^(?:🔍\s*)?浏览服务\s*$/)
  async listServicesCompat(@Ctx() ctx: ExtendedContext) {
    await this.uiService.sendMainKeyboard(
      ctx,
      '功能已迁移至小程序，体验更佳！',
    );
  }

  @Hears(/^(?:⭐\s*)?我的收藏\s*$/)
  async listCollections(@Ctx() ctx: ExtendedContext) {
    await this.uiService.sendMainKeyboard(
      ctx,
      '功能已迁移至小程序，体验更佳！',
    );
  }

  @Hears(/^(?:👤\s*)?个人中心\s*$/)
  async showProfile(@Ctx() ctx: ExtendedContext) {
    await this.uiService.sendMainKeyboard(
      ctx,
      '功能已迁移至小程序，体验更佳！',
    );
  }

  @Hears('媒体库')
  async onMediaLibrary(@Ctx() ctx: ExtendedContext) {
    const mediaUrl = this.configService.get<string>('MEDIA_LIBRARY_URL');
    if (!mediaUrl) {
      await ctx.reply('媒体库未配置');
      return;
    }
    await ctx.reply('点击下方按钮打开媒体库：', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '打开媒体库',
              web_app: { url: mediaUrl },
            },
          ],
        ],
      },
    });
  }

  @Hears(/测试/)
  async onTestNewDomain(@Ctx() ctx: ExtendedContext) {
    // 优先读取数据库配置的备用域名列表
    // 格式: { "active": "https://booking.com", "backups": ["https://bk1.com"] }
    const domains = await this.systemConfigPort.get<{
      active: string;
      backups: string[];
    }>('network.h5_domains', {
      active: '',
      backups: [],
    });

    // 回退逻辑：如果数据库没配，尝试读环境变量作为基准（符合环境隔离原则）
    const envH5Url =
      this.configService.get<string>('TELEGRAM_H5_BASE_URL') ||
      this.configService.get<string>('H5_URL') ||
      '';

    const currentBase = domains?.active || envH5Url;
    const backupList = domains?.backups || [];

    if (!currentBase) {
      await ctx.reply('H5 入口域名未配置');
      return;
    }

    const normalizedCurrent = currentBase.replace(/\/$/, '');

    const backupButtons = backupList.map((url, index) => {
      const normalized = url.replace(/\/$/, '');
      return [
        {
          text: `🔄 打开备选域名 ${index + 1}`,
          web_app: { url: `${normalized}/#/pages/index/index` },
        },
      ];
    });

    await ctx.reply(
      '🚀 *多域名连通性测试*\n\n' +
        `当前主域名：\`${normalizedCurrent}\`\n` +
        (backupList.length > 0
          ? `备选域名：\n${backupList.map((u) => `- \`${u}\``).join('\n')}\n\n`
          : '\n') +
        '👉 *登录失败排查建议：*\n' +
        '1. **网络波动**：Tunnel 首次建立连接可能稍慢，请稍等或重试。\n' +
        '2. **授权绑定**：请确保已在 @BotFather 中执行 `/setdomain` 并指向当前主域名。\n' +
        '3. **安全拦截**：若经常失败，请检查 Cloudflare 后台是否有 Security 拦截记录。',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 打开主域名',
                web_app: { url: `${normalizedCurrent}/#/pages/index/index` },
              },
            ],
            ...backupButtons,
          ],
        },
      },
    );
  }

  private async handleLoginToken(ctx: ExtendedContext, token: string) {
    const chatId = String(ctx.chat?.id);
    const user = ctx.from;

    try {
      const status = await this.bindingAppService.loginByDeepLinkToken(
        token,
        chatId,
        {
          username: user?.username,
          first_name: user?.first_name,
          last_name: user?.last_name,
        },
      );
      if (status === 'invalid') {
        await ctx.reply('❌ 登录链接已失效或已被使用。');
        return;
      }
      await this.uiService.sendMainKeyboard(
        ctx,
        '✅ 登录成功！你现在可以返回网页，系统将自动跳转首页。',
      );
    } catch (error: unknown) {
      this.logger.error('Login via deep link failed.');
      await ctx.reply(
        error instanceof TelegramMutationReplayBlockedError
          ? TELEGRAM_MUTATION_REPLAY_MESSAGE
          : '❌ 登录失败，请重试。',
      );
    }
  }

  private async handleImportStartPayload(
    ctx: ExtendedContext,
    importCode: string,
  ) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('无法识别当前会话，请重试。');
      return;
    }
    this.logger.log('[TG_IMPORT_START]');
    try {
      const { fullNode } = await this.importAppService.importContent({
        chatId,
        telegramUser: ctx.from,
        content: importCode,
      });

      let text = '✅ 已通过机器人链接完成收藏';
      if (fullNode.status !== 'ACTIVE' || !fullNode.service?.is_active) {
        text += '\n⚠️ 该服务当前已下架或暂停，暂时无法预约。';
      }
      await this.uiService.sendCollectionCard(ctx, fullNode, text);
      this.logger.log('[TG_IMPORT_SUCCESS]');
    } catch (e: unknown) {
      const errorText = this.errorNormalizer.extractErrorText(e, '');
      const queryErrorCode = this.errorNormalizer.extractQueryErrorCode(e);
      const parsedMessage = this.messageParser.buildImportFailureMessage({
        content: importCode,
        errorText,
        queryErrorCode,
      });
      this.logger.warn('[TG_IMPORT_FAIL]');
      if (parsedMessage === '您已收藏过该服务') {
        await this.uiService.sendMainKeyboard(
          ctx,
          '你已收藏过该服务，可直接使用下方菜单继续操作。',
        );
        return;
      }
      await this.uiService.sendMainKeyboard(
        ctx,
        parsedMessage ||
          '链接已打开，但暂未成功导入。请重试或直接发送分享链接。',
      );
    }
  }

  private async handleReferralStartPayload(
    ctx: ExtendedContext,
    referralCode: string,
  ) {
    const chatId = ctx.chat?.id;
    const code = referralCode.trim().toUpperCase();
    if (!code) {
      await this.uiService.sendMainKeyboard(ctx, '推荐码无效，请重试。');
      return;
    }
    if (!chatId) {
      await ctx.reply('无法识别当前会话，请重试。');
      return;
    }

    try {
      const user = await this.authService.validateBotUser(chatId, ctx.from);
      const referrer = await this.usersPort.findByReferralCode(code);

      if (referrer && user.id !== referrer.id && !user.referrer_id) {
        user.referrer_id = referrer.id;
        const saveReferral = () => this.usersPort.save(user);
        if (this.mutationFence) {
          await this.mutationFence.executeOnce(
            'bind_referral',
            `${user.id}:${referrer.id}`,
            saveReferral,
          );
        } else {
          await saveReferral();
        }
        this.logger.log('[TG_REFERRAL_BOUND]');
      } else {
        this.logger.log(
          `[TG_REFERRAL_SKIP] reason=${referrer ? 'already_bound_or_self' : 'invalid_code'}`,
        );
      }
    } catch (error: unknown) {
      this.logger.error('[TG_REFERRAL_FAIL]');
      if (error instanceof TelegramMutationReplayBlockedError) {
        await ctx.reply(TELEGRAM_MUTATION_REPLAY_MESSAGE);
        return;
      }
    }

    const firstName = ctx.from?.first_name || '朋友';
    this.logger.log('[TG_REFERRAL_START]');
    const messageText =
      this.configService.get<string>('TELEGRAM_START_MESSAGE') ||
      `👋 你好，${firstName}！\n欢迎使用通用预约系统。\n\n请选择下方功能开始使用：`;
    await this.uiService.sendMainKeyboard(ctx, messageText);
  }

  private async handleBindingToken(ctx: ExtendedContext, token: string) {
    const chatId = String(ctx.chat?.id);
    try {
      const result = await this.bindingAppService.bindByToken(
        token,
        chatId,
        ctx.from?.username,
      );
      if (result.status === 'invalid') {
        await ctx.reply('❌ 绑定链接已失效或无效，请在小程序中重新发起。');
        return;
      }
      if (result.status === 'already_bound') {
        await this.uiService.sendMainKeyboard(
          ctx,
          '✅ 你的 Telegram 账号已与该系统账号绑定，无需重复操作。',
        );
        return;
      }
      if (result.status === 'confirm_required') {
        const message = `⚠️ 检测到该 Telegram 账号已绑定到另一个系统账号 (${result.existingName})。\n\n是否要将该 Telegram 账号改绑到当前正在操作的账号？`;
        await ctx.reply(message, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ 确认合并/改绑',
                  callback_data: `confirm_merge_${token}`,
                },
                { text: '❌ 取消', callback_data: 'cancel_merge' },
              ],
            ],
          },
        });
        return;
      }
      await this.uiService.sendMainKeyboard(
        ctx,
        '✅ 你的 Telegram 账号已成功绑定到系统。现在可以返回小程序继续操作。',
      );
    } catch (error: unknown) {
      this.logger.error('Binding failed.');
      await ctx.reply(
        error instanceof TelegramMutationReplayBlockedError
          ? TELEGRAM_MUTATION_REPLAY_MESSAGE
          : '❌ 绑定失败，请重试。',
      );
    }
  }

  @Action(/^confirm_merge_(.+)$/)
  async confirmMerge(@Ctx() ctx: ExtendedContext) {
    const user = ctx.from;
    const match = ctx.match;
    if (!user || !match) return;

    const token = match[1];

    try {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在处理合并...',
        'menu_confirm_merge',
      );
      const chatId = String(ctx.chat?.id);
      const result = await this.bindingAppService.confirmMergeByToken(
        token,
        chatId,
      );
      if (result === 'invalid') {
        await this.callbackService.answerCbQuerySafely(
          ctx,
          '❌ 绑定链接已失效',
          'menu_confirm_merge',
        );
        await ctx.editMessageText('❌ 绑定链接已失效，请重新发起。');
        return;
      }
      if (result === 'merged') {
        await ctx.editMessageText('✅ 账号合并成功！已完成绑定。');
        await this.uiService.sendMainKeyboard(ctx, '请开始使用：');
        return;
      }
      await ctx.editMessageText('⚠️ 未找到可合并账号。');
    } catch (error: unknown) {
      this.logger.error('Merge failed.');
      await this.callbackService.answerCbQuerySafely(
        ctx,
        error instanceof TelegramMutationReplayBlockedError
          ? '结果待确认，请在网页检查'
          : '❌ 合并失败',
        'menu_confirm_merge',
      );
    }
  }

  @Action('main_menu')
  async backToMainMenu(@Ctx() ctx: ExtendedContext) {
    try {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        undefined,
        'menu_main_menu',
      );
      await this.uiService.sendMainKeyboard(ctx, '请选择下方功能：');
    } catch {
      this.logger.error('Failed to go back to main menu.');
    }
  }

  @Action('my_orders')
  async showMyOrders(@Ctx() ctx: ExtendedContext) {
    try {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        undefined,
        'menu_my_orders',
      );
      await this.uiService.sendMainKeyboard(
        ctx,
        '功能已迁移至小程序，体验更佳！',
      );
    } catch {
      this.logger.error('Failed to show my orders.');
    }
  }

  @Action('cancel_merge')
  async cancelMerge(@Ctx() ctx: ExtendedContext) {
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '已取消',
      'menu_cancel_merge',
    );
    await ctx.editMessageText('❌ 已取消改绑操作。');
  }

  @Command('help')
  async help(@Ctx() ctx: ExtendedContext) {
    const helpMessage =
      '📖 *使用指南*\n\n' +
      '1. ⭐ *收藏服务*：发送分享链接、Slug 或二维码图片即可收藏。\n' +
      '2. 💰 *加价设置*：在收藏卡片点击“加价”，按提示输入金额或百分比。\n' +
      '3. 📢 *推广与预定*：在收藏卡片点击“推广”或“预定”即可继续操作。\n' +
      '4. 🧭 *底部菜单*：可直接进入“服务 / 收藏 / 个人中心”。\n\n' +
      '如遇异常，请重新发送链接或稍后重试。';

    await this.uiService.sendMainKeyboard(ctx, helpMessage);
  }

  @Action(/^(distribution_reg_|agent_reg_)(\w+)$/)
  async onDistributionReg(@Ctx() ctx: ExtendedContext) {
    const user = ctx.from;
    const match = ctx.match;
    if (!user || !match) return;

    const actionPrefix = match[1];
    const referralCode = match[2];
    if (actionPrefix === 'agent_reg_') {
      this.logger.warn(`Legacy callback prefix detected: ${actionPrefix}`);
    }
    this.logger.log(
      `User ${user.id} registering as distribution with code ${referralCode}`,
    );

    try {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在处理申请...',
        'menu_distribution_reg',
      );
      await ctx.editMessageText('✅ 申请已提交，请等待审核。');
    } catch {
      this.logger.error('Failed to register distribution.');
    }
  }

  @Action(/^(distribution_info_|agent_info_)(\w+)$/)
  async onDistributionInfo(@Ctx() ctx: ExtendedContext) {
    const user = ctx.from;
    const match = ctx.match;
    if (!user || !match) return;

    const actionPrefix = match[1];
    if (actionPrefix === 'agent_info_') {
      this.logger.warn(`Legacy callback prefix detected: ${actionPrefix}`);
    }
    const distributionId = match[2];
    try {
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在获取信息...',
        'menu_distribution_info',
      );
      await ctx.editMessageText(
        `👤 分销信息 (ID: ${distributionId})\n\n暂无更多详情。`,
      );
    } catch {
      this.logger.error('Failed to get distribution info.');
    }
  }

  @Action('confirm_binding')
  async onConfirmBinding(@Ctx() ctx: ExtendedContext) {
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '正在确认...',
      'menu_confirm_binding',
    );
    await ctx.editMessageText('✅ 绑定已确认。');
    await this.uiService.sendMainKeyboard(ctx, '绑定成功！');
  }

  @Action('cancel_binding')
  async onCancelBinding(@Ctx() ctx: ExtendedContext) {
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '已取消',
      'menu_cancel_binding',
    );
    await ctx.editMessageText('❌ 绑定已取消。');
  }

  @Action('refresh_status')
  async onRefreshStatus(@Ctx() ctx: ExtendedContext) {
    await this.callbackService.answerCbQuerySafely(
      ctx,
      '状态已刷新',
      'menu_refresh_status',
    );
    await this.uiService.sendMainKeyboard(ctx, '当前状态已是最新。');
  }
}
