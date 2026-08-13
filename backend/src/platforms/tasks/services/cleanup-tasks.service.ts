import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { CleanupTasksServicesPort } from '../ports/cleanup-tasks-services.port';
import type { CleanupTasksUsersPort } from '../ports/cleanup-tasks-users.port';
import {
  CLEANUP_TASKS_SERVICES_PORT,
  CLEANUP_TASKS_USERS_PORT,
} from '../ports/tokens';

@Injectable()
export class CleanupTasksService {
  private readonly logger = new Logger(CleanupTasksService.name);

  constructor(
    @Inject(CLEANUP_TASKS_SERVICES_PORT)
    private readonly servicesPort: CleanupTasksServicesPort,
    @Inject(CLEANUP_TASKS_USERS_PORT)
    private readonly usersPort: CleanupTasksUsersPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Cleans up expired service blocks every hour.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredBlocks() {
    this.logger.log('[Cleanup] Starting expired service blocks cleanup...');
    try {
      const affected = await this.servicesPort.cleanupExpiredBlocks();
      this.logger.log(
        `[Cleanup] Successfully removed ${affected} expired blocks.`,
      );
    } catch (e) {
      this.logger.error('[Cleanup] Failed to cleanup expired blocks', e);
    }
  }

  /**
   * Cleans up expired refresh tokens every day.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredTokens() {
    this.logger.log('[Cleanup] Starting expired refresh tokens cleanup...');
    try {
      const affected = await this.usersPort.cleanupAllExpiredTokens();
      this.logger.log(
        `[Cleanup] Successfully removed ${affected} expired refresh tokens.`,
      );
    } catch (e) {
      this.logger.error('[Cleanup] Failed to cleanup expired tokens', e);
    }
  }

  /**
   * Cleans up expired telegram binding tokens every hour.
   * Dispatches an event to decouple from TelegramModule.
   */
  @Cron(CronExpression.EVERY_HOUR)
  cleanupTelegramTokens() {
    this.logger.log('[Cleanup] Dispatching telegram.tokens.cleanup event...');
    try {
      this.eventEmitter.emit('telegram.tokens.cleanup');
    } catch (e) {
      this.logger.error(
        '[Cleanup] Failed to dispatch telegram tokens cleanup event',
        e,
      );
    }
  }
}
