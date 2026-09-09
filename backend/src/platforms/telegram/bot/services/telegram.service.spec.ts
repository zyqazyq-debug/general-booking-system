import { TelegramService } from './telegram.service';
import { ConfigService } from '@nestjs/config';

describe('TelegramService', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  it('reports delivery failure when a token is unavailable', async () => {
    process.env.NODE_ENV = 'test';
    process.env.TELEGRAM_BOT_TOKEN = 'DUMMY';
    const service = new TelegramService({} as never, config('DUMMY'));

    await expect(service.send('recipient', 'content')).resolves.toBe(false);
  });

  it('reports Telegram API rejection as a delivery failure', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const service = new TelegramService({
      telegram: {
        sendMessage: jest.fn().mockRejectedValue(new Error('failed')),
      },
    } as never, config('test-token'));

    await expect(service.send('recipient', 'content')).resolves.toBe(false);
  });
});
  const config = (token: string) =>
    ({ get: jest.fn().mockReturnValue(token) }) as unknown as ConfigService;
