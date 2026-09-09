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
        TELEGRAM_BOT_TOKEN: 'fixture-token',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
        TELEGRAM_WEBHOOK_LEASE_MS: '120000',
      }),
    ).toMatchObject({ TELEGRAM_BOT_MODE: 'webhook' });
  });

  it('rejects a webhook lease shorter than the handler safety window', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_TOKEN: 'fixture-token',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
        TELEGRAM_WEBHOOK_LEASE_MS: '90000',
      }),
    ).toThrow('TELEGRAM_WEBHOOK_LEASE_MS must be an integer');
  });

  it('rejects webhook mode without a bot token', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram/webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test_secret',
      }),
    ).toThrow('TELEGRAM_BOT_TOKEN is required');
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
        USE_POSTGRES: 'true',
        POSTGRES_HOST: 'postgres',
        POSTGRES_USER: 'booking',
        POSTGRES_PASSWORD: 'test-password',
        POSTGRES_DB: 'booking',
        REDIS_HOST: 'redis',
        REDIS_PASSWORD: 'test-redis-password',
        TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: 'true',
      }),
    ).toThrow('TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP is forbidden');
  });
});

describe('validateEnv production database', () => {
  const productionEnv = () => ({
    ...baseEnv(),
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://example.test',
    USE_POSTGRES: 'true',
    POSTGRES_HOST: 'postgres',
    POSTGRES_USER: 'booking',
    POSTGRES_PASSWORD: 'test-password',
    POSTGRES_DB: 'booking',
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: 'test-redis-password',
  });

  it('requires PostgreSQL in production', () => {
    expect(() =>
      validateEnv({ ...productionEnv(), USE_POSTGRES: 'false' }),
    ).toThrow('USE_POSTGRES must be true in production');
  });

  it('accepts an explicitly configured production PostgreSQL database', () => {
    expect(validateEnv(productionEnv())).toMatchObject({
      USE_POSTGRES: 'true',
      POSTGRES_HOST: 'postgres',
    });
  });

  it('does not require the Telegram data secret for an inactive token-only utility process', () => {
    expect(
      validateEnv({
        ...productionEnv(),
        TELEGRAM_BOT_TOKEN: '12345:test-token',
      }),
    ).toMatchObject({ TELEGRAM_BOT_TOKEN: '12345:test-token' });
  });

  it('fails closed when the preproduction Telegram egress URL is not the dedicated SOCKS endpoint', () => {
    expect(() =>
      validateEnv({
        ...baseEnv(),
        BOOKING_TELEGRAM_EGRESS_REQUIRED: 'true',
        TELEGRAM_PROXY_URL: 'http://192.168.3.5:7893',
      }),
    ).toThrow('TELEGRAM_PROXY_URL must be socks5h://telegram-egress:1080');
    expect(() =>
      validateEnv({
        ...baseEnv(),
        BOOKING_TELEGRAM_EGRESS_REQUIRED: 'true',
        TELEGRAM_PROXY_URL: 'socks5h://telegram-egress:1080',
      }),
    ).not.toThrow();
  });

  it('requires a dedicated Telegram data encryption secret for active production delivery', () => {
    expect(() =>
      validateEnv({
        ...productionEnv(),
        TELEGRAM_BOT_TOKEN: '12345:test-token',
        BOOKING_WORKERS_ENABLED: 'true',
      }),
    ).toThrow('TELEGRAM_DATA_ENCRYPTION_SECRET is required');
  });

  it('accepts a dedicated Telegram data encryption secret in production', () => {
    expect(
      validateEnv({
        ...productionEnv(),
        TELEGRAM_BOT_TOKEN: '12345:test-token',
        BOOKING_WORKERS_ENABLED: 'true',
        TELEGRAM_DATA_ENCRYPTION_SECRET:
          'telegram-data-encryption-secret-at-least-32-bytes',
      }),
    ).toMatchObject({ TELEGRAM_BOT_TOKEN: '12345:test-token' });
  });

  it('rejects reusing another production secret for Telegram data encryption', () => {
    const reused = 'reused-secret-material-at-least-32-characters';
    expect(() =>
      validateEnv({
        ...productionEnv(),
        TELEGRAM_BOT_TOKEN: '12345:test-token',
        BOOKING_WORKERS_ENABLED: 'true',
        JWT_SECRET1: reused,
        TELEGRAM_DATA_ENCRYPTION_SECRET: reused,
      }),
    ).toThrow('must be independent from other secrets');
  });
});
