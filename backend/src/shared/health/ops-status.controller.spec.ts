import { ServiceUnavailableException } from '@nestjs/common';
import { OpsStatusController } from './ops-status.controller';
import { RAW_RESPONSE_METADATA } from '../common/decorators/raw-response.decorator';

describe('OpsStatusController', () => {
  const config = (values: Record<string, string>) => ({
    get: jest.fn((key: string) => values[key]),
  });
  const cache = () => ({
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue('ready'),
    del: jest.fn().mockResolvedValue(undefined),
  });

  it('reports process liveness without an infrastructure dependency', () => {
    const controller = new OpsStatusController(
      config({}) as any,
      { isInitialized: false } as any,
      cache() as any,
    );
    expect(controller.live()).toEqual({
      status: 'up',
      releaseId: 'unbound',
      gitSha: 'unbound',
      manifestDigest: 'unbound',
      slot: 'unbound',
      configSchema: 'unbound',
      migrationFloor: 'unbound',
      migrationCatalogDigest: 'unbound',
      telegramBotMode: 'disabled',
      telegramWebhookEnabled: false,
      telegramWebhookUrl: '',
    });
  });

  it('requires an initialized database for readiness', async () => {
    const controller = new OpsStatusController(
      config({}) as any,
      { isInitialized: false } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns only non-secret release identity fields', () => {
    const controller = new OpsStatusController(
      config({
        BOOKING_RELEASE_ID: 'booking-test',
        BOOKING_GIT_SHA: 'abc123',
        BOOKING_MANIFEST_DIGEST: 'sha256:manifest',
        BOOKING_SLOT: 'green',
        BOOKING_CONFIG_SCHEMA_VERSION: 'booking.config/v1',
        BOOKING_MIGRATION_FLOOR: '1788740000000-AddOrderSourceIdempotencyKey',
        BOOKING_MIGRATION_CATALOG_DIGEST: 'sha256:catalog',
      }) as any,
      { isInitialized: true, query: jest.fn() } as any,
      cache() as any,
    );
    expect(controller.version()).toEqual({
      status: 'up',
      releaseId: 'booking-test',
      gitSha: 'abc123',
      manifestDigest: 'sha256:manifest',
      slot: 'green',
      configSchema: 'booking.config/v1',
      migrationFloor: '1788740000000-AddOrderSourceIdempotencyKey',
      migrationCatalogDigest: 'sha256:catalog',
      telegramBotMode: 'disabled',
      telegramWebhookEnabled: false,
      telegramWebhookUrl: '',
    });
  });

  it('requires the durable Telegram inbox migration when webhook ingress is enabled', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([
        { inbox_relation: null, operation_relation: null },
      ]);
    const controller = new OpsStatusController(
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://app.example/telegram/webhook',
        TELEGRAM_DATA_ENCRYPTION_SECRET:
          'ticket-encryption-secret-at-least-32-bytes',
      }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('is ready only after the enabled Telegram inbox relation exists', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([
        {
          inbox_relation: 'telegram_webhook_updates',
          operation_relation: 'telegram_webhook_operations',
          ticket_relation: 'telegram_binding_tickets',
        },
      ]);
    const controller = new OpsStatusController(
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://app.example/telegram/webhook',
        TELEGRAM_DATA_ENCRYPTION_SECRET:
          'ticket-encryption-secret-at-least-32-bytes',
      }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('rejects readiness when the durable Telegram ticket table is missing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([
        {
          inbox_relation: 'telegram_webhook_updates',
          operation_relation: 'telegram_webhook_operations',
          ticket_relation: null,
        },
      ]);
    const controller = new OpsStatusController(
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://app.example/telegram/webhook',
        TELEGRAM_DATA_ENCRYPTION_SECRET:
          'ticket-encryption-secret-at-least-32-bytes',
      }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects readiness when persistent ticket encryption is unavailable', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);
    const controller = new OpsStatusController(
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_URL: 'https://app.example/telegram/webhook',
      }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects readiness when webhook is enabled without webhook mode and URL', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const controller = new OpsStatusController(
      config({ TELEGRAM_ENABLE_WEBHOOK: 'true' }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects readiness when the database ledger is below the release floor', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ name: 'OldFloor1788730000000' }]);
    const controller = new OpsStatusController(
      config({
        BOOKING_MIGRATION_FLOOR: '1788740000000-AddOrderSourceIdempotencyKey',
      }) as any,
      { isInitialized: true, query } as any,
      cache() as any,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('marks release gate endpoints as raw transport contracts', () => {
    for (const handler of [
      OpsStatusController.prototype.live,
      OpsStatusController.prototype.ready,
      OpsStatusController.prototype.version,
    ]) {
      expect(Reflect.getMetadata(RAW_RESPONSE_METADATA, handler)).toBe(true);
    }
  });
});
