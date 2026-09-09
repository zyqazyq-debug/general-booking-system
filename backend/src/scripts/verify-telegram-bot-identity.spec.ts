import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { verifyTelegramBotIdentity } from './verify-telegram-bot-identity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('verifyTelegramBotIdentity', () => {
  beforeEach(() => jest.clearAllMocks());

  it('performs only getMe and returns exact bot identity evidence', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        ok: true,
        result: { id: 123, username: 'happybooking_preprod_bot' },
      },
    } as any);
    const result = await verifyTelegramBotIdentity(
      ['--expected-bot-username=happybooking_preprod_bot'],
      { TELEGRAM_BOT_TOKEN: 'secret-token' },
    );
    expect(result).toMatchObject({
      schema: 'booking.telegram-bot-identity/v1',
      action: 'getMe',
      botId: 123,
      botUsername: 'happybooking_preprod_bot',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      'https://api.telegram.org/botsecret-token/getMe',
    );
    expect(mockedAxios.get.mock.calls[0][1]).toMatchObject({ proxy: false });
  });

  it('rejects a different Telegram bot username', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { ok: true, result: { id: 123, username: 'another_bot' } },
    } as any);
    await expect(
      verifyTelegramBotIdentity(
        ['--expected-bot-username=happybooking_preprod_bot'],
        { TELEGRAM_BOT_TOKEN: 'secret-token' },
      ),
    ).rejects.toThrow('TELEGRAM_BOT_IDENTITY_MISMATCH');
  });

  it('uses the shared SOCKS transport without exposing credentials', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        ok: true,
        result: { id: 123, username: 'happybooking_preprod_bot' },
      },
    } as any);
    await verifyTelegramBotIdentity(
      ['--expected-bot-username=happybooking_preprod_bot'],
      {
        TELEGRAM_BOT_TOKEN: 'secret-token',
        TELEGRAM_PROXY_URL:
          'socks5h://proxy-user:proxy-password@proxy.example:1080',
      },
    );
    expect(mockedAxios.get.mock.calls[0][1]).toMatchObject({ proxy: false });
    expect(mockedAxios.get.mock.calls[0][1]?.httpsAgent).toBeInstanceOf(
      SocksProxyAgent,
    );
  });

  it('returns a stable non-secret code for an invalid proxy URL', async () => {
    const credential = 'proxy-password-material';
    const failure = await verifyTelegramBotIdentity(
      ['--expected-bot-username=happybooking_preprod_bot'],
      {
        TELEGRAM_BOT_TOKEN: 'secret-token',
        TELEGRAM_PROXY_URL: `ftp://proxy-user:${credential}@proxy.example:21`,
      },
    ).catch((error: Error) => error);
    expect(failure.message).toBe('TELEGRAM_PROXY_CONFIG_INVALID');
    expect(failure.message).not.toContain(credential);
    expect(mockedAxios.get.mock.calls).toHaveLength(0);
  });
});
