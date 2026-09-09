import axios from 'axios';
import {
  setTelegramWebhook,
  validateTelegramWebhookArguments,
} from './set-telegram-webhook';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const argv = [
  '--action=set',
  '--environment=preproduction',
  '--expected-bot-id=123456',
  '--expected-bot-username=booking_preprod_bot',
  '--url=https://booking-preprod.happybooking.uk/telegram/webhook',
  '--ready-url=https://booking-preprod.happybooking.uk/readyz',
  '--expected-release-id=booking-20260909T010203Z-abcdef123456',
  `--expected-git-sha=${'a'.repeat(40)}`,
  `--expected-manifest-digest=sha256:${'b'.repeat(64)}`,
  '--expected-config-schema=booking.config/v1',
  '--expected-migration-floor=1788740000000-AddOrderSourceIdempotencyKey',
  `--expected-migration-catalog-digest=sha256:${'c'.repeat(64)}`,
];
const env = {
  NODE_ENV: 'preproduction',
  TELEGRAM_BOT_TOKEN: '123456:secret-token-material',
  TELEGRAM_WEBHOOK_SECRET_TOKEN: 'webhook_secret_value',
};
const ready = {
  status: 'ready',
  releaseId: 'booking-20260909T010203Z-abcdef123456',
  gitSha: 'a'.repeat(40),
  manifestDigest: `sha256:${'b'.repeat(64)}`,
  configSchema: 'booking.config/v1',
  migrationFloor: '1788740000000-AddOrderSourceIdempotencyKey',
  migrationCatalogDigest: `sha256:${'c'.repeat(64)}`,
  telegramBotMode: 'webhook',
  telegramWebhookEnabled: true,
  telegramWebhookUrl:
    'https://booking-preprod.happybooking.uk/telegram/webhook',
};

describe('one-shot Telegram webhook operation', () => {
  beforeEach(() => jest.resetAllMocks());

  it('fails closed unless action, environment, identity and exact URL are supplied', () => {
    expect(() =>
      validateTelegramWebhookArguments([
        '--action=delete',
        '--environment=preproduction',
        '--expected-bot-id=123456',
        '--url=https://booking-preprod.happybooking.uk/telegram/webhook',
      ]),
    ).toThrow('INVALID_ACTION');
    expect(() =>
      validateTelegramWebhookArguments([
        '--action=set',
        '--environment=staging',
        '--expected-bot-id=123456',
        '--url=https://booking-preprod.happybooking.uk/telegram/webhook',
      ]),
    ).toThrow('INVALID_ENVIRONMENT');
    expect(() =>
      validateTelegramWebhookArguments([
        '--action=set',
        '--environment=production',
        '--url=https://app.happybooking.uk/telegram/webhook?unexpected=true',
      ]),
    ).toThrow();
  });

  it('binds each environment to its one exact public hostname', () => {
    expect(() =>
      validateTelegramWebhookArguments([
        '--action=set',
        '--environment=preproduction',
        '--expected-bot-id=123456',
        '--url=https://app.happybooking.uk/telegram/webhook',
      ]),
    ).toThrow('INVALID_WEBHOOK_URL');
    expect(() =>
      validateTelegramWebhookArguments([
        '--action=set',
        '--environment=production',
        '--expected-bot-id=123456',
        '--url=https://booking-preprod.happybooking.uk/telegram/webhook',
      ]),
    ).toThrow('INVALID_WEBHOOK_URL');
    expect(
      validateTelegramWebhookArguments(
        argv.map((item) =>
          item
            .replace('--environment=preproduction', '--environment=production')
            .replace(
              'https://booking-preprod.happybooking.uk/',
              'https://app.happybooking.uk/',
            ),
        ),
      ).url,
    ).toBe('https://app.happybooking.uk/telegram/webhook');
  });

  it('checks getMe before mutation and rejects an unexpected bot', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ready })
      .mockResolvedValueOnce({
        data: { ok: true, result: { id: 999999, username: 'wrong_bot' } },
      });

    await expect(setTelegramWebhook(argv, env)).rejects.toThrow(
      'BOT_IDENTITY_MISMATCH',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refuses Telegram mutation when ready identity or schema is stale', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { ...ready, migrationFloor: '1788730000000-OldFloor' },
    });
    await expect(setTelegramWebhook(argv, env)).rejects.toThrow(
      'CANDIDATE_READINESS_IDENTITY_MISMATCH',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refuses mutation when candidate readiness does not prove webhook enablement', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { ...ready, telegramWebhookEnabled: false },
    });
    await expect(setTelegramWebhook(argv, env)).rejects.toThrow(
      'CANDIDATE_READINESS_IDENTITY_MISMATCH',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refuses mutation when candidate advertises a different webhook URL', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        ...ready,
        telegramWebhookUrl: 'https://unexpected.example/telegram/webhook',
      },
    });
    await expect(setTelegramWebhook(argv, env)).rejects.toThrow(
      'CANDIDATE_READINESS_IDENTITY_MISMATCH',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects a command/runtime environment mismatch before any API call', async () => {
    await expect(
      setTelegramWebhook(argv, { ...env, NODE_ENV: 'production' }),
    ).rejects.toThrow('RUNTIME_ENVIRONMENT_MISMATCH');
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('sets and reads back the exact webhook, returning a non-secret receipt', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ready })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: { id: 123456, username: 'booking_preprod_bot' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            url: 'https://booking-preprod.happybooking.uk/telegram/webhook',
            pending_update_count: 0,
            max_connections: 40,
          },
        },
      });
    mockedAxios.post.mockResolvedValueOnce({
      data: { ok: true, result: true },
    });

    const receipt = await setTelegramWebhook(
      argv,
      env,
      () => new Date('2026-09-09T01:02:03.000Z'),
    );

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://booking-preprod.happybooking.uk/readyz',
      { timeout: 15_000 },
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/getMe$/),
      { timeout: 15_000 },
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/setWebhook$/),
      {
        url: 'https://booking-preprod.happybooking.uk/telegram/webhook',
        secret_token: 'webhook_secret_value',
        drop_pending_updates: false,
      },
      { timeout: 15_000 },
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/getWebhookInfo$/),
      { timeout: 15_000 },
    );
    expect(receipt).toEqual({
      schemaVersion: 1,
      action: 'set',
      environment: 'preproduction',
      completedAt: '2026-09-09T01:02:03.000Z',
      bot: { id: 123456, username: 'booking_preprod_bot' },
      candidate: {
        releaseId: 'booking-20260909T010203Z-abcdef123456',
        gitSha: 'a'.repeat(40),
        manifestDigest: `sha256:${'b'.repeat(64)}`,
        configSchema: 'booking.config/v1',
        migrationFloor: '1788740000000-AddOrderSourceIdempotencyKey',
        migrationCatalogDigest: `sha256:${'c'.repeat(64)}`,
      },
      webhook: {
        url: 'https://booking-preprod.happybooking.uk/telegram/webhook',
        pendingUpdateCount: 0,
        maxConnections: 40,
      },
      verification: {
        candidateReady: true,
        getMeIdentityMatched: true,
        setWebhookAccepted: true,
        readBackUrlMatched: true,
      },
    });
    expect(JSON.stringify(receipt)).not.toContain('secret');
    expect(JSON.stringify(receipt)).not.toContain('123456:');
  });

  it('independently verifies current webhook state without mutating Telegram', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ready })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: { id: 123456, username: 'booking_preprod_bot' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            url: 'https://booking-preprod.happybooking.uk/telegram/webhook',
            pending_update_count: 0,
          },
        },
      });

    const receipt = await setTelegramWebhook(
      argv.map((item) => item.replace('--action=set', '--action=verify')),
      { NODE_ENV: 'preproduction', TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN },
      () => new Date('2026-09-09T01:02:04.000Z'),
    );

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(receipt.action).toBe('verify');
    expect(receipt.verification).toEqual({
      candidateReady: true,
      getMeIdentityMatched: true,
      readBackUrlMatched: true,
    });
  });

  it('fails closed when the read-back URL differs', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ready })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: { id: 123456, username: 'booking_preprod_bot' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            url: 'https://unexpected.example/telegram/webhook',
            pending_update_count: 0,
          },
        },
      });
    mockedAxios.post.mockResolvedValueOnce({
      data: { ok: true, result: true },
    });

    await expect(setTelegramWebhook(argv, env)).rejects.toThrow(
      'WEBHOOK_READ_BACK_MISMATCH',
    );
  });

  it('redacts transport diagnostics that may contain the Bot API token', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ready })
      .mockRejectedValueOnce(
        new Error(
          'request failed at https://api.telegram.org/bot123456:secret-token-material/getMe',
        ),
      );

    const failure = await setTelegramWebhook(argv, env).catch(
      (error: Error) => error,
    );
    expect(failure.message).toBe('TELEGRAM_API_OPERATION_FAILED');
    expect(failure.message).not.toContain('secret-token-material');
  });
});
