import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule, TelegrafModuleOptions } from 'nestjs-telegraf';
import axios from 'axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramBindingTicket } from './persistence/telegram-binding-ticket.entity';

import { TelegramWebAppAuthService } from './auth/telegram-webapp-auth.service';
import { TelegramService } from './bot/services/telegram.service';
import { TelegramBindingService } from './bot/services/telegram-binding.service';
import { TelegramValidatorService } from './bot/services/telegram-validator.service';
import { telegrafLoggerMiddleware } from './bot/middleware/logger.middleware';
import { telegrafRateLimitMiddleware } from './bot/middleware/rate-limit.middleware';
import {
  createTelegramHttpConfig,
  type TelegramHttpConfig,
} from './telegram-http-config';

const TELEGRAM_VALIDATOR = 'ITelegramValidator';
const TELEGRAM_NOTIFICATION_CHANNEL = 'ITelegramNotificationChannel';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([TelegramBindingTicket]),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        const proxyUrl = configService.get<string>('TELEGRAM_PROXY_URL');
        const botMode = (
          configService.get<string>('TELEGRAM_BOT_MODE') || 'polling'
        ).toLowerCase();

        const webhookUrl = configService.get<string>('TELEGRAM_WEBHOOK_URL');
        const webhookSecret = configService.get<string>(
          'TELEGRAM_WEBHOOK_SECRET_TOKEN',
        );
        const enableWebhook =
          configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true';
        const pollingDeleteWebhookOnStartup =
          configService.get<string>(
            'TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP',
          ) === 'true';

        const logger = new Logger('TelegrafModule');

        if (!token || token === 'DUMMY') {
          logger.warn(
            'TELEGRAM_BOT_TOKEN is not configured or DUMMY. Bot will NOT be initialized.',
          );
          return {
            token: 'DUMMY',
            launchOptions: false,
          } as unknown as TelegrafModuleOptions;
        }

        const options: TelegrafModuleOptions = {
          token,
          middlewares: [telegrafLoggerMiddleware, telegrafRateLimitMiddleware],
        };

        let httpConfig: TelegramHttpConfig;
        try {
          httpConfig = createTelegramHttpConfig(proxyUrl);
        } catch {
          logger.error(
            'Telegram HTTP transport configuration is invalid. Bot launch disabled for this process.',
          );
          return { token, launchOptions: false } as TelegrafModuleOptions;
        }

        if (enableWebhook && botMode === 'webhook') {
          if (!webhookUrl || !webhookSecret) {
            logger.error(
              'Webhook mode is disabled because TELEGRAM_WEBHOOK_URL or TELEGRAM_WEBHOOK_SECRET_TOKEN is missing.',
            );
          } else {
            logger.log(
              'Using Telegram webhook delivery through the Nest /telegram/webhook route.',
            );
          }
          // Nest owns the HTTP route. Do not let Telegraf create a second
          // listener or mutate the remote webhook whenever this process starts.
          options.launchOptions = false;
        } else if (botMode === 'polling' && pollingDeleteWebhookOnStartup) {
          logger.log('Telegram polling is explicitly enabled.');
          // Launch occurs after Nest has registered update handlers in
          // TelegramPlatformModule, rather than during provider construction.
          options.launchOptions = false;
        } else {
          logger.warn(
            'Telegram delivery is disabled. Set webhook mode with an explicit URL and secret, or explicitly allow polling to clear an existing webhook.',
          );
          options.launchOptions = false;
        }

        if (httpConfig.agent) {
          logger.log('Using configured Telegram proxy.');
          options.options = {
            telegram: {
              agent: httpConfig.agent,
              apiRoot: 'https://api.telegram.org',
            },
          };
        }

        try {
          await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
            ...httpConfig.axios,
            timeout: 8000,
          });
        } catch {
          logger.error(
            'Telegram API unavailable. Bot launch disabled for this process.',
          );
          return { token, launchOptions: false } as TelegrafModuleOptions;
        }

        return options;
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    TelegramWebAppAuthService,
    TelegramService,
    TelegramBindingService,
    TelegramValidatorService,
    {
      provide: TELEGRAM_VALIDATOR,
      useExisting: TelegramValidatorService,
    },
    {
      provide: TELEGRAM_NOTIFICATION_CHANNEL,
      useExisting: TelegramService,
    },
  ],
  exports: [
    TelegramWebAppAuthService,
    TelegramService,
    TelegramBindingService,
    TelegramValidatorService,
    TELEGRAM_VALIDATOR,
    TELEGRAM_NOTIFICATION_CHANNEL,
  ],
})
export class TelegramCoreModule {}
