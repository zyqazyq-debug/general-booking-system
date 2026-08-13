import {
  Module,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';

import { TelegramMenuUpdate } from './bot/updates/telegram.menu.update';
import { TelegramImportUpdate } from './bot/updates/telegram.import.update';
import { TelegramBookingUpdate } from './bot/updates/telegram.booking.update';
import { TelegramPricingUpdate } from './bot/updates/telegram.pricing.update';
import { TelegramImportService } from './bot/services/telegram-import.service';
import { TelegramMessageParserService } from './bot/services/telegram-message-parser.service';
import { TelegramImportTextCommandService } from './bot/services/telegram-import-text-command.service';
import { TelegramImportActionService } from './bot/services/telegram-import-action.service';
import { TelegramQrService } from './bot/services/telegram-qr.service';
import { TelegramErrorNormalizerService } from './bot/services/telegram-error-normalizer.service';
import { TelegramUiService } from './bot/services/telegram-ui.service';
import { TelegramSessionStateService } from './bot/services/telegram-session-state.service';
import { TelegramCallbackService } from './bot/services/telegram-callback.service';
import { TelegramAuthService } from './bot/services/telegram-auth.service';
import { TelegramBookingApplicationService } from './application/telegram-booking.application.service';
import { TelegramBindingApplicationService } from './application/telegram-binding.application.service';
import { TelegramImportApplicationService } from './application/telegram-import.application.service';
import { TelegramPricingApplicationService } from './application/telegram-pricing.application.service';
import { CommandParserService } from './bot/services/command-parser.service';

import { TelegramCoreModule } from './telegram-core.module';
import { HealthTelegramAdapter } from './bot/adapters/health-telegram.adapter';
import { HEALTH_TELEGRAM_PORT } from '../../shared/health/ports/tokens';

@Module({
  imports: [TelegramCoreModule],
  providers: [
    TelegramMenuUpdate,
    TelegramImportUpdate,
    TelegramBookingUpdate,
    TelegramPricingUpdate,
    TelegramImportService,
    TelegramMessageParserService,
    TelegramImportTextCommandService,
    TelegramImportActionService,
    TelegramQrService,
    TelegramErrorNormalizerService,
    TelegramCallbackService,
    TelegramUiService,
    TelegramAuthService,
    TelegramSessionStateService,
    TelegramBookingApplicationService,
    TelegramBindingApplicationService,
    TelegramImportApplicationService,
    TelegramPricingApplicationService,
    CommandParserService,
    HealthTelegramAdapter,
    {
      provide: HEALTH_TELEGRAM_PORT,
      useFactory: (adapter: HealthTelegramAdapter) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (
          process.env.NODE_ENV === 'test' ||
          !token ||
          token === 'DUMMY' ||
          token === 'dummy'
        ) {
          return null;
        }
        return adapter;
      },
      inject: [HealthTelegramAdapter],
    },
  ],
  exports: [TelegramCoreModule, HEALTH_TELEGRAM_PORT],
})
export class TelegramPlatformModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPlatformModule.name);
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryRunning = false;

  constructor(
    @Inject(getBotToken()) private readonly bot: Telegraf<Context>,
    private readonly configService: ConfigService,
  ) {}

  private buildLaunchOptions() {
    const botMode = (
      this.configService.get<string>('TELEGRAM_BOT_MODE') || 'polling'
    ).toLowerCase();
    const enableWebhook =
      this.configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true';
    const webhookBase =
      this.configService.get<string>('TELEGRAM_WEBHOOK_URL') ||
      this.configService.get<string>('API_URL');

    if (enableWebhook && botMode === 'webhook' && webhookBase) {
      return {
        webhook: {
          domain: webhookBase.replace(/^https?:\/\//, ''),
          path: '/telegram/webhook',
        },
      };
    }

    return {
      allowedUpdates: [],
      webhook: undefined,
    };
  }

  private getRecoveryRetryMs() {
    const raw = this.configService.get<string>('TELEGRAM_RECOVERY_RETRY_MS');
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 5000) {
      return parsed;
    }
    return 30000;
  }

  private startRecoveryLoop() {
    if (this.recoveryTimer) return;
    const retryMs = this.getRecoveryRetryMs();
    this.logger.warn(
      `Telegram degraded mode enabled. Will retry recovery every ${retryMs}ms.`,
    );
    this.recoveryTimer = setInterval(() => {
      void this.tryRecoverTelegram();
    }, retryMs);
  }

  private stopRecoveryLoop() {
    if (!this.recoveryTimer) return;
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private async tryRecoverTelegram() {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;

    try {
      const me = await this.bot.telegram.getMe();
      await this.bot.launch(this.buildLaunchOptions());
      this.logger.log(
        `Telegram Bot recovery succeeded: @${me.username} (${me.first_name})`,
      );
      this.stopRecoveryLoop();
    } catch (e) {
      this.logger.warn(
        `Telegram recovery retry failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.recoveryRunning = false;
    }
  }

  async onModuleInit() {
    try {
      const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      if (!token || token === 'DUMMY') {
        this.logger.warn(
          'TELEGRAM_BOT_TOKEN is DUMMY. Skipping bot info fetch in E2E environment.',
        );
        return;
      }

      const me = await this.bot?.telegram?.getMe();
      if (me) {
        this.logger.log(
          `Telegram Bot connected: @${me.username} (${me.first_name})`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Failed to get bot info: ${e instanceof Error ? e.message : String(e)}`,
      );
      this.startRecoveryLoop();
    }
    this.logger.log('TelegramPlatformModule initialized. Bot is running.');
  }

  onModuleDestroy() {
    this.stopRecoveryLoop();
    this.logger.log('TelegramPlatformModule destroyed.');
  }
}
