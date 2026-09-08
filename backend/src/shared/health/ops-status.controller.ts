import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Controller()
export class OpsStatusController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('livez')
  live() {
    return { status: 'live' };
  }

  @Get('readyz')
  async ready() {
    try {
      if (!this.dataSource.isInitialized) {
        throw new Error('database data source is not initialized');
      }
      await this.dataSource.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready' });
    }
  }

  @Get('__ops/version')
  version() {
    return {
      releaseId: this.config.get<string>('BOOKING_RELEASE_ID') || 'unbound',
      gitSha: this.config.get<string>('BOOKING_GIT_SHA') || 'unbound',
      manifestDigest:
        this.config.get<string>('BOOKING_MANIFEST_DIGEST') || 'unbound',
      slot: this.config.get<string>('BOOKING_SLOT') || 'unbound',
    };
  }
}
