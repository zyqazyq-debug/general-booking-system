import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import {
  OpsLivenessResponseDto,
  OpsNotReadyResponseDto,
  OpsReadinessResponseDto,
} from './ops-status.response.dto';

@Controller()
@ApiTags('ops')
export class OpsStatusController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Get('livez')
  @RawResponse()
  @ApiOkResponse({ type: OpsLivenessResponseDto })
  live() {
    return { status: 'up', ...this.identity() };
  }

  @Get('readyz')
  @RawResponse()
  @ApiOkResponse({ type: OpsReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: OpsNotReadyResponseDto })
  async ready() {
    try {
      if (!this.dataSource.isInitialized) {
        throw new Error('database data source is not initialized');
      }
      await this.dataSource.query('SELECT 1');
      const cacheProbeKey = `ops:ready:${randomUUID()}`;
      await this.cache.set(cacheProbeKey, 'ready', 5_000);
      const cacheProbe = await this.cache.get(cacheProbeKey);
      await this.cache.del(cacheProbeKey);
      if (cacheProbe !== 'ready') throw new Error('cache probe mismatch');
      const migrationFloor = this.config.get<string>('BOOKING_MIGRATION_FLOOR');
      if (migrationFloor) {
        const match = /^(\d{10,})-([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(
          migrationFloor,
        );
        if (!match) throw new Error('configured migration floor is invalid');
        const rows = (await this.dataSource.query(
          'SELECT "name" FROM "migrations" ORDER BY "timestamp" DESC, "id" DESC LIMIT 1',
        )) as Array<{ name: string }>;
        if (rows[0]?.name !== `${match[2].replace(/-/g, '')}${match[1]}`) {
          throw new Error('database migration floor does not match release');
        }
      }
      if (this.config.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true') {
        if (
          this.config.get<string>('TELEGRAM_BOT_MODE')?.toLowerCase() !==
            'webhook' ||
          !this.config.get<string>('TELEGRAM_WEBHOOK_URL')
        ) {
          throw new Error('telegram webhook runtime configuration is invalid');
        }
        const ticketEncryptionKey = this.config.get<string>(
          'TELEGRAM_DATA_ENCRYPTION_SECRET',
        );
        if (!ticketEncryptionKey || ticketEncryptionKey.length < 32) {
          throw new Error(
            'telegram persistent ticket encryption dependency is unavailable',
          );
        }
        await this.dataSource
          .query(
            "SELECT to_regclass('public.telegram_webhook_updates') AS inbox_relation, to_regclass('public.telegram_webhook_operations') AS operation_relation, to_regclass('public.telegram_binding_tickets') AS ticket_relation",
          )
          .then(
            (
              rows: Array<{
                inbox_relation: string | null;
                operation_relation: string | null;
                ticket_relation: string | null;
              }>,
            ) => {
              if (
                !rows[0]?.inbox_relation ||
                !rows[0]?.operation_relation ||
                !rows[0]?.ticket_relation
              ) {
                throw new Error(
                  'telegram webhook and ticket persistence migrations are not applied',
                );
              }
            },
          );
      }
      return { status: 'ready', ...this.identity() };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready' });
    }
  }

  @Get('__ops/version')
  @RawResponse()
  @ApiOkResponse({ type: OpsLivenessResponseDto })
  version() {
    return { status: 'up', ...this.identity() };
  }

  private identity() {
    return {
      releaseId: this.config.get<string>('BOOKING_RELEASE_ID') || 'unbound',
      gitSha: this.config.get<string>('BOOKING_GIT_SHA') || 'unbound',
      manifestDigest:
        this.config.get<string>('BOOKING_MANIFEST_DIGEST') || 'unbound',
      slot: this.config.get<string>('BOOKING_SLOT') || 'unbound',
      configSchema:
        this.config.get<string>('BOOKING_CONFIG_SCHEMA_VERSION') || 'unbound',
      migrationFloor:
        this.config.get<string>('BOOKING_MIGRATION_FLOOR') || 'unbound',
      migrationCatalogDigest:
        this.config.get<string>('BOOKING_MIGRATION_CATALOG_DIGEST') ||
        'unbound',
      telegramBotMode:
        this.config.get<string>('TELEGRAM_BOT_MODE')?.toLowerCase() ||
        'disabled',
      telegramWebhookEnabled:
        this.config.get<string>('TELEGRAM_ENABLE_WEBHOOK') === 'true',
      telegramWebhookUrl: this.config.get<string>('TELEGRAM_WEBHOOK_URL') || '',
    };
  }
}
