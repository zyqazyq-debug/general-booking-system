import { TelegramService } from './telegram.service';

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
    const service = new TelegramService({} as never);

    await expect(service.send('recipient', 'content')).resolves.toBe(false);
  });

  it('reports Telegram API rejection as a delivery failure', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const service = new TelegramService({
      telegram: {
        sendMessage: jest.fn().mockRejectedValue(new Error('failed')),
      },
    } as never);

    await expect(service.send('recipient', 'content')).resolves.toBe(false);
  });
});
