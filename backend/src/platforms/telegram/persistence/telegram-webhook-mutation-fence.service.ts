import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { QueryFailedError, Repository } from 'typeorm';
import { TelegramWebhookInboxService } from './telegram-webhook-inbox.service';
import { TelegramWebhookOperation } from './telegram-webhook-operation.entity';
import {
  decryptTelegramData,
  encryptTelegramData,
} from './telegram-data-encryption';

export const TELEGRAM_MUTATION_REPLAY_MESSAGE =
  '请求结果待确认，为避免重复操作已暂停重试，请在网页中检查最终状态。';

export class TelegramMutationReplayBlockedError extends Error {
  constructor() {
    super(TELEGRAM_MUTATION_REPLAY_MESSAGE);
    this.name = TelegramMutationReplayBlockedError.name;
  }
}

@Injectable()
export class TelegramWebhookMutationFenceService {
  constructor(
    @InjectRepository(TelegramWebhookOperation)
    private readonly operations: Repository<TelegramWebhookOperation>,
    private readonly inbox: TelegramWebhookInboxService,
    private readonly configService: ConfigService,
  ) {}

  async executeOnce<T>(
    operation: string,
    resourceIdentity: string,
    work: () => Promise<T>,
    completedReplay: 'block' | 'return' = 'block',
  ): Promise<T> {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(operation)) {
      throw new Error('Invalid Telegram mutation operation name.');
    }
    const execution = await this.inbox.assertCurrentExecutionOwnership();
    const botIdentity = this.getBotIdentity();
    const resourceHash = createHash('sha256')
      .update(resourceIdentity)
      .digest('hex');
    const key = `telegram:${botIdentity}:${execution.updateId}:${operation}:${resourceHash}`;

    try {
      await this.operations.insert({
        idempotency_key: key,
        update_id: String(execution.updateId),
        operation,
        resource_hash: resourceHash,
        status: 'started',
        result_payload: null,
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        if (completedReplay === 'return') {
          const existing = await this.operations.findOne({
            select: { status: true },
            where: { idempotency_key: key },
          });
          if (existing?.status === 'completed') return undefined as T;
        }
        throw new TelegramMutationReplayBlockedError();
      }
      throw error;
    }

    try {
      await this.inbox.assertCurrentExecutionOwnership();
      const result = await work();
      const completed = await this.operations.update(
        { idempotency_key: key, status: 'started' },
        { status: 'completed' },
      );
      if (completed.affected !== 1) {
        throw new TelegramMutationReplayBlockedError();
      }
      return result;
    } catch (error) {
      await this.operations
        .update(
          { idempotency_key: key, status: 'started' },
          { status: 'failed' },
        )
        .catch(() => undefined);
      throw error;
    }
  }

  async executeOnceRecoverable<T>(
    operation: string,
    resourceIdentity: string,
    work: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(operation)) {
      throw new Error('Invalid Telegram mutation operation name.');
    }
    const execution = await this.inbox.assertCurrentExecutionOwnership();
    const botIdentity = this.getBotIdentity();
    const resourceHash = createHash('sha256')
      .update(resourceIdentity)
      .digest('hex');
    const key = `telegram:${botIdentity}:${execution.updateId}:${operation}:${resourceHash}`;

    try {
      await this.operations.insert({
        idempotency_key: key,
        update_id: String(execution.updateId),
        operation,
        resource_hash: resourceHash,
        status: 'started',
        result_payload: null,
      });
    } catch (error: unknown) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.operations.findOne({
        select: { status: true, result_payload: true },
        where: { idempotency_key: key },
      });
      if (existing?.status !== 'completed' || !existing.result_payload) {
        throw new TelegramMutationReplayBlockedError();
      }
      return {
        result: this.decryptResult<T>(existing.result_payload, key),
        replayed: true,
      };
    }

    try {
      await this.inbox.assertCurrentExecutionOwnership();
      const result = await work();
      const completed = await this.operations.update(
        { idempotency_key: key, status: 'started' },
        {
          status: 'completed',
          result_payload: this.encryptResult(result, key),
        },
      );
      if (completed.affected !== 1) {
        throw new TelegramMutationReplayBlockedError();
      }
      return { result, replayed: false };
    } catch (error) {
      await this.operations
        .update(
          { idempotency_key: key, status: 'started' },
          { status: 'failed' },
        )
        .catch(() => undefined);
      throw error;
    }
  }

  async recoverCompletedResult<T>(
    operation: string,
    resourceIdentity: string,
  ): Promise<T | null> {
    const execution = await this.inbox.assertCurrentExecutionOwnership();
    const resourceHash = createHash('sha256')
      .update(resourceIdentity)
      .digest('hex');
    const key = `telegram:${this.getBotIdentity()}:${execution.updateId}:${operation}:${resourceHash}`;
    const existing = await this.operations.findOne({
      select: { status: true, result_payload: true },
      where: { idempotency_key: key },
    });
    if (existing?.status !== 'completed' || !existing.result_payload) {
      return null;
    }
    return this.decryptResult<T>(existing.result_payload, key);
  }

  executeOnceVoid(
    operation: string,
    resourceIdentity: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    return this.executeOnce(
      operation,
      resourceIdentity,
      async () => {
        await work();
      },
      'return',
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string; errno?: number };
    return (
      driverError.code === '23505' ||
      driverError.code === 'SQLITE_CONSTRAINT' ||
      driverError.errno === 19
    );
  }

  private getBotIdentity(): string {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    const botId = token?.match(/^(\d+):/)?.[1];
    if (!botId) {
      throw new Error(
        'Telegram bot identity is unavailable for mutation fencing.',
      );
    }
    return botId;
  }

  private encryptResult<T>(result: T, keyId: string): string {
    return encryptTelegramData(result, keyId, this.configService);
  }

  private decryptResult<T>(payload: string, keyId: string): T {
    const [ivText, tagText, ciphertextText, extra] = payload.split('.');
    if (!ivText || !tagText || !ciphertextText || extra) {
      throw new TelegramMutationReplayBlockedError();
    }
    try {
      return decryptTelegramData<T>(payload, keyId, this.configService);
    } catch {
      throw new TelegramMutationReplayBlockedError();
    }
  }
}
