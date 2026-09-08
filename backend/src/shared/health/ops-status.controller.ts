import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
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
    };
  }
}
