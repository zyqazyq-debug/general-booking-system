import { Controller, Get, Inject, Optional } from '@nestjs/common';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheck,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HEALTH_TELEGRAM_PORT } from './ports/tokens';
import type { HealthTelegramPort } from './ports/health-telegram.port';

@ApiTags('系统运维')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    @Optional()
    @Inject(HEALTH_TELEGRAM_PORT)
    private readonly telegramPort?: HealthTelegramPort,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: '系统健康检查',
    description: '检查数据库、内存和磁盘状态',
  })
  async check() {
    const core = await this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 256 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 512 * 1024 * 1024),
    ]);

    const telegram = await this.checkTelegram();

    const info =
      telegram.telegram.status === 'up'
        ? { ...core.info, ...telegram }
        : core.info;
    const error =
      telegram.telegram.status === 'down'
        ? { ...core.error, ...telegram }
        : core.error;

    return {
      ...core,
      info,
      error,
      details: { ...core.details, ...telegram },
    };
  }

  private async checkTelegram(): Promise<HealthIndicatorResult> {
    if (!this.telegramPort) {
      return {
        telegram: {
          status: 'up',
          message: 'Telegram port not configured',
        },
      };
    }

    const timeoutMs = 1500;
    try {
      const info = await Promise.race([
        this.telegramPort.getBotInfo(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Telegram check timeout')),
            timeoutMs,
          ),
        ),
      ]);

      return {
        telegram: {
          status: 'up',
          username: info.username,
          id: info.id as any,
        },
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      return {
        telegram: {
          status: 'down',
          message: error.message,
        },
      };
    }
  }
}
