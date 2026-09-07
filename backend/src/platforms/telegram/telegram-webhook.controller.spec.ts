import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { TelegramWebhookController } from './telegram-webhook.controller';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('TelegramWebhookController', () => {
  const secret = 'test_secret';
  let callback: jest.Mock;
  let bot: jest.Mocked<Pick<Telegraf<Context>, 'webhookCallback'>>;
  let response: { sendStatus: jest.Mock };

  beforeEach(() => {
    callback = jest.fn().mockResolvedValue(undefined);
    bot = {
      webhookCallback: jest.fn().mockReturnValue(callback),
    };
    response = { sendStatus: jest.fn() };
  });

  it('rejects a webhook request without the Telegram secret header', async () => {
    const controller = new TelegramWebhookController(
      bot as unknown as Telegraf<Context>,
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: secret,
      }),
    );

    await controller.receive({ headers: {} } as any, response as any);

    expect(response.sendStatus).toHaveBeenCalledWith(403);
    expect(bot.webhookCallback).not.toHaveBeenCalled();
  });

  it('passes a verified request to Telegraf with the same secret', async () => {
    const controller = new TelegramWebhookController(
      bot as unknown as Telegraf<Context>,
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: secret,
      }),
    );
    const request = {
      headers: { 'x-telegram-bot-api-secret-token': secret },
    };

    await controller.receive(request as any, response as any);

    expect(bot.webhookCallback).toHaveBeenCalledWith('/telegram/webhook', {
      secretToken: secret,
    });
    expect(callback).toHaveBeenCalledWith(request, response);
  });
});
