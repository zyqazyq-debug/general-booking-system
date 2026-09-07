import { validateEnv } from './env.validation';

const baseEnv = () => ({
  JWT_SECRET: 'test-secret',
  TELEGRAM_BOT_MODE: 'polling',
  TELEGRAM_ENABLE_WEBHOOK: 'false',
});

describe('validateEnv Telegram delivery mode', () => {
  it('rejects webhook enablement when polling is selected', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        TELEGRAM_ENABLE_WEBHOOK: 'true',
      }),
    ).toThrow('TELEGRAM_ENABLE_WEBHOOK must be false');
  });

  it('rejects webhook mode unless webhook delivery is explicitly enabled', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        TELEGRAM_BOT_MODE: 'webhook',
      }),
    ).toThrow('TELEGRAM_ENABLE_WEBHOOK must be true');
  });

  it('accepts an explicitly configured webhook mode', () => {
    expect(
      validateEnv({
        ...baseEnv(),
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
      }),
    ).toMatchObject({ TELEGRAM_BOT_MODE: 'webhook' });
  });

  it('rejects an unknown delivery mode', () => {
    expect(() =>
      validateEnv({ ...baseEnv(), TELEGRAM_BOT_MODE: 'both' }),
    ).toThrow('TELEGRAM_BOT_MODE must be polling or webhook');
  });

  it('forbids polling webhook deletion during production startup', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://example.test',
        TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'true',
      }),
    ).toThrow('TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP is forbidden');
  });
});
