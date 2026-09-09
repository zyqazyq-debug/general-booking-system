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

    await expect(service.send('recipient', 'content')).resolves.toEqual({
      outcome: 'failed',
      errorType: 'ChannelUnavailable',
    });
  });

  it('returns the provider message ID after Telegram confirms delivery', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const service = new TelegramService(
      {
        telegram: {
          sendMessage: jest.fn().mockResolvedValue({ message_id: 421 }),
        },
      } as never,
      config('test-token'),
    );

    await expect(service.send('recipient', 'content')).resolves.toEqual({
      outcome: 'sent',
      providerMessageId: '421',
    });
  });

  it('classifies a Telegram 4xx rejection as definitively failed', async () => {
    process.env.NODE_ENV = 'development';
    const service = new TelegramService(
      {
        telegram: {
          sendMessage: jest.fn().mockRejectedValue({
            response: {
              error_code: 403,
              description: 'sensitive provider text',
            },
          }),
        },
      } as never,
      config('test-token'),
    );

    await expect(service.send('private-chat', 'private-body')).resolves.toEqual(
      {
        outcome: 'failed',
        errorType: 'TelegramApi403',
      },
    );
  });

  it('classifies a transport timeout as uncertain without logging payload data', async () => {
    process.env.NODE_ENV = 'development';
    const service = new TelegramService(
      {
        telegram: {
          sendMessage: jest.fn().mockRejectedValue(
            Object.assign(new Error('private-body test-token private-chat'), {
              code: 'ETIMEDOUT',
            }),
          ),
        },
      } as never,
      config('test-token'),
    );
    const logger = (service as unknown as { logger: { error: jest.Mock } })
      .logger;
    jest.spyOn(logger, 'error');

    await expect(service.send('private-chat', 'private-body')).resolves.toEqual(
      {
        outcome: 'uncertain',
        errorType: 'TransportInterrupted',
      },
    );
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('private-chat');
    expect(logged).not.toContain('private-body');
    expect(logged).not.toContain('test-token');
  });
});
const config = (token: string) =>
  ({ get: jest.fn().mockReturnValue(token) }) as unknown as ConfigService;
