import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule, TelegrafModuleOptions } from 'nestjs-telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios, { AxiosRequestConfig } from 'axios';

import { TelegramWebAppAuthService } from './auth/telegram-webapp-auth.service';
import { TelegramService } from './bot/services/telegram.service';
import { TelegramBindingService } from './bot/services/telegram-binding.service';
import { TelegramValidatorService } from './bot/services/telegram-validator.service';
import { telegrafLoggerMiddleware } from './bot/middleware/logger.middleware';
import { telegrafRateLimitMiddleware } from './bot/middleware/rate-limit.middleware';

const TELEGRAM_VALIDATOR = 'ITelegramValidator';
const TELEGRAM_NOTIFICATION_CHANNEL = 'ITelegramNotificationChannel';

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        const proxyUrl = configService.get<string>('TELEGRAM_PROXY_URL');
        const botMode = (
          configService.get<string>('TELEGRAM_BOT_MODE') || 'polling'
        ).toLowerCase();

        const webhookUrl = configService.get<string>('API_URL');
        const enableWebhook =
          configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true';

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

        if (enableWebhook && webhookUrl && botMode === 'webhook') {
          logger.log(`Using Telegram Webhook: ${webhookUrl}`);
          options.launchOptions = {
            webhook: {
              domain: webhookUrl.replace(/^https?:\/\//, ''),
              path: '/telegram/webhook',
            },
          };
        } else {
          logger.log(`Using Telegram Polling (Mode: ${botMode})`);
          options.launchOptions = {
            allowedUpdates: [],
            webhook: undefined,
          };
        }

        if (proxyUrl) {
          logger.log(`Using Telegram Proxy: ${proxyUrl}`);
          try {
            const isSocks = proxyUrl.startsWith('socks');
            const agent = isSocks
              ? new SocksProxyAgent(proxyUrl)
              : new HttpsProxyAgent(proxyUrl);

            options.options = {
              telegram: {
                agent,
                apiRoot: 'https://api.telegram.org',
              },
            };
          } catch (e: unknown) {
            const error = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to initialize proxy agent: ${error}`);
          }
        }

        try {
          const axiosConfig: AxiosRequestConfig = {};
          if (proxyUrl) {
            const isSocks = proxyUrl.startsWith('socks');
            const agent = isSocks
              ? new SocksProxyAgent(proxyUrl)
              : new HttpsProxyAgent(proxyUrl);
            axiosConfig.httpsAgent = agent;
            axiosConfig.proxy = false;
          }
          await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
            ...axiosConfig,
            timeout: 8000,
          });
        } catch (e: unknown) {
          const error = e instanceof Error ? e.message : String(e);
          logger.error(
            `Telegram API unavailable. Bot launch disabled for this process: ${error}`,
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
