import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';

import {
  ValidationPipe,
  ClassSerializerInterceptor,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransformInterceptor } from './shared/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './shared/common/exceptions/all-exceptions.filter';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { setupSwagger } from './shared/common/setup-swagger';
import {
  setupTelegramWebhook,
  deleteTelegramWebhook,
} from './shared/common/setup-telegram';
import { initBackendSentry } from './shared/common/observability/sentry';

declare const module: {
  hot?: {
    accept: () => void;
    dispose: (callback: () => void) => void;
  };
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 恢复标准日志级别，以便查看 Telegram 交互日志
    logger: ['log', 'error', 'warn'],
  });

  app.use(helmet()); // Add security headers
  app.use(cookieParser());

  app.setGlobalPrefix('api', {
    exclude: [
      '/',
      'health',
      'telegram/webhook',
      'r/:code',
      's/:slug',
      'admin-panel',
      { path: 'admin-panel/*path', method: RequestMethod.ALL },
    ],
  });

  // Enable Gzip compression to reduce payload size (e.g. for large schedule queries)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  app.use(compression());

  const configService = app.get(ConfigService);
  const isProd = process.env.NODE_ENV === 'production';
  const envName = process.env.NODE_ENV || 'development (default)';
  const botName = configService.get<string>('TELEGRAM_BOT_NAME');
  const botMode = configService.get<string>('TELEGRAM_BOT_MODE');
  const webhookEnabled = configService.get<string>('TELEGRAM_ENABLE_WEBHOOK');
  const dbHost = configService.get<string>('POSTGRES_HOST');
  const dbName = configService.get<string>('POSTGRES_DB');
  const apiUrl = configService.get<string>('API_URL');

  console.log('--------------------------------------------------');
  console.log(`🚀 Starting Backend Service`);
  console.log(`📂 Process CWD:      ${process.cwd()}`);
  console.log(`🌍 Environment:      ${envName}`);
  console.log(`🤖 Bot Name:         @${botName}`);
  console.log(
    `📡 Bot Mode:         ${botMode} (Webhook Enabled: ${webhookEnabled})`,
  );
  console.log(`🔗 API URL:          ${apiUrl}`);
  console.log(`🗄️  Database:         ${dbHost}/${dbName}`);
  console.log('--------------------------------------------------');

  const sentryEnabled = initBackendSentry();
  if (sentryEnabled) {
    console.log('🛰️  Sentry:           enabled');
  }

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .filter((o) => o);
  if (isProd && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is not configured for production');
  }

  app.enableCors({
    // In production, use strict whitelist. In dev, allow all (reflect origin).
    origin: isProd ? allowedOrigins : true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  }); // Enable CORS for frontend
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not in DTO
      forbidNonWhitelisted: true, // throw error if extra props
      transform: true, // auto transform types
    }),
  );
  // Enable global serialization (for @Exclude in entities)
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Setup Swagger
  setupSwagger(app);

  // Setup Telegram Webhook
  const activeBotMode = (
    configService.get<string>('TELEGRAM_BOT_MODE') || 'polling'
  ).toLowerCase();
  const enableWebhook =
    activeBotMode === 'webhook' &&
    String(
      configService.get<string>('TELEGRAM_ENABLE_WEBHOOK') || '',
    ).toLowerCase() === 'true';

  if (enableWebhook) {
    // We removed the !module.hot check to force webhook setup even in dev mode
    // This ensures webhook is always registered when configured
    await setupTelegramWebhook(configService);
  } else {
    console.log(
      `Skipping Telegram Webhook setup (Mode: ${activeBotMode}, WebhookEnabled: ${enableWebhook}). Ensure Polling is active.`,
    );
    // If webhook is disabled, try to delete it to ensure polling works
    await deleteTelegramWebhook(configService);
  }

  const activePortIndex = configService.get<string>('PORT_ACTIVE_INDEX') || '1';
  const port1 = configService.get<number>('PORT1') || 3001;
  const port2 = configService.get<number>('PORT2') || 3001;

  const port =
    activePortIndex === '2'
      ? port2
      : port1 || configService.get<number>('PORT') || 3001;

  await app.listen(port, '0.0.0.0');
  console.log(`Backend is listening on port ${port}`);
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => {
      void app.close();
    });
  }
}
void bootstrap();
