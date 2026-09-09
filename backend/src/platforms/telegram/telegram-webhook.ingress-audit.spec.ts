import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { getBotToken } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TELEGRAM_WEBHOOK_INGRESS_AUDIT } from './telegram-webhook.ingress-audit';
import { TelegramWebhookInboxService } from './persistence/telegram-webhook-inbox.service';

describe('Telegram webhook ingress audit declaration', () => {
  it('records the external ingress as non-SDK and keeps it out of Swagger', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramWebhookController],
      providers: [
        {
          provide: getBotToken(),
          useValue: { webhookCallback: jest.fn() } as Partial<
            Telegraf<Context>
          >,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: TelegramWebhookInboxService,
          useValue: {},
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );

    expect(document.paths['/telegram/webhook']).toBeUndefined();
    expect(TELEGRAM_WEBHOOK_INGRESS_AUDIT).toEqual({
      endpoint: 'POST /telegram/webhook',
      owner: 'platforms/telegram',
      externalAdapter:
        'Telegram Bot API -> durable inbox -> Telegraf handleUpdate',
      sdkExposure:
        'excluded: external adapter ingress, not a public API client',
      reviewDueOn: '2026-12-07',
      verificationResponsibilities: {
        route: 'main.ts excludes telegram/webhook from the api global prefix',
        secret:
          'controller validates X-Telegram-Bot-Api-Secret-Token before Telegraf',
        schema:
          'controller does not model Telegram Update as a public DTO or SDK input',
        idempotency:
          'at-least-once: update_id is durably claimed and lease-renewed before completion; external Telegram effects are not exactly-once',
        operations:
          'Telegram deployment operations verify the root path and secret separately',
      },
    });

    await app.close();
  });
});
