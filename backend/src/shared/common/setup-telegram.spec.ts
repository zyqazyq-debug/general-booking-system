import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { deleteTelegramWebhook, setupTelegramWebhook } from './setup-telegram';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('Telegram webhook setup', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedAxios.post.mockResolvedValue({ data: { ok: true } });
  });

  it('does not mutate Telegram remote state during a normal startup', async () => {
    await setupTelegramWebhook(
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
        TELEGRAM_BOT_TOKEN: 'test-token',
      }),
    );

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('registers only an explicit HTTPS webhook endpoint in an operator run', async () => {
    await setupTelegramWebhook(
      config({
        TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP: 'true',
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
        TELEGRAM_BOT_TOKEN: 'test-token',
      }),
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/setWebhook',
      {
        url: 'https://example.test/telegram/webhook',
        secret_token: 'test_secret',
      },
      {},
    );
  });

  it('rejects implicit API_URL and a malformed endpoint', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation();
    await setupTelegramWebhook(
      config({
        TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP: 'true',
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        API_URL: 'https://example.test/api',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/api/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
        TELEGRAM_BOT_TOKEN: 'test-token',
      }),
    );

    expect(mockedAxios.post).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('requires a separate destructive-action gate before deleting a webhook', async () => {
    await deleteTelegramWebhook(
      config({
        TELEGRAM_WEBHOOK_MANAGE_ON_STARTUP: 'true',
        TELEGRAM_BOT_TOKEN: 'test-token',
      }),
    );

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
