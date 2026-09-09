import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { QueryFailedError, Repository } from 'typeorm';
import {
  TELEGRAM_WEBHOOK_UPDATE_PROCESSED,
  TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
  TelegramWebhookUpdate,
} from './telegram-webhook-update.entity';

const DEFAULT_LEASE_MS = 120_000;
const MIN_LEASE_MS = 120_000;
const MAX_LEASE_MS = 900_000;

export class TelegramWebhookClaimOwnershipLostError extends Error {
  constructor() {
    super('Telegram webhook claim ownership was lost.');
    this.name = TelegramWebhookClaimOwnershipLostError.name;
  }
}

export class TelegramWebhookLeaseRenewalError extends Error {
  constructor() {
    super('Telegram webhook claim lease renewal failed.');
    this.name = TelegramWebhookLeaseRenewalError.name;
  }
}

export type TelegramWebhookClaim =
  | { kind: 'claimed'; token: string }
  | { kind: 'duplicate' }
  | { kind: 'in-flight' };

@Injectable()
export class TelegramWebhookInboxService {
  private readonly execution = new AsyncLocalStorage<{
    updateId: number;
    token: string;
  }>();
  constructor(
    @InjectRepository(TelegramWebhookUpdate)
    private readonly updates: Repository<TelegramWebhookUpdate>,
    private readonly configService: ConfigService,
  ) {}

  async claim(updateId: number): Promise<TelegramWebhookClaim> {
    const update_id = String(updateId);
    const token = randomUUID();
    const now = new Date();
    const lease_expires_at = new Date(now.getTime() + this.getLeaseMs());

    try {
      await this.updates.insert({
        update_id,
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
        claim_token: token,
        lease_expires_at,
        processed_at: null,
      });
      return { kind: 'claimed', token };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }

    const reclaimed = await this.updates
      .createQueryBuilder()
      .update(TelegramWebhookUpdate)
      .set({
        claim_token: token,
        lease_expires_at,
        updated_at: now,
      })
      .where('update_id = :updateId', { updateId: update_id })
      .andWhere('status = :status', {
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
      })
      .andWhere('lease_expires_at <= :now', { now })
      .execute();

    if (reclaimed.affected === 1) {
      return { kind: 'claimed', token };
    }

    const existing = await this.updates.findOne({
      select: { status: true },
      where: { update_id },
    });
    if (!existing) {
      // A failed handler can release its claim between the conflicting insert
      // and this read. Let Telegram retry instead of acknowledging an update
      // that no process currently owns.
      return { kind: 'in-flight' };
    }

    return existing.status === TELEGRAM_WEBHOOK_UPDATE_PROCESSED
      ? { kind: 'duplicate' }
      : { kind: 'in-flight' };
  }

  async complete(updateId: number, token: string): Promise<void> {
    const completed = await this.updates
      .createQueryBuilder()
      .update(TelegramWebhookUpdate)
      .set({
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSED,
        processed_at: new Date(),
      })
      .where('update_id = :updateId', { updateId: String(updateId) })
      .andWhere('status = :status', {
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
      })
      .andWhere('claim_token = :token', { token })
      .execute();

    if (completed.affected !== 1) {
      throw new TelegramWebhookClaimOwnershipLostError();
    }
  }

  async renew(updateId: number, token: string): Promise<void> {
    const now = new Date();
    const renewed = await this.updates
      .createQueryBuilder()
      .update(TelegramWebhookUpdate)
      .set({
        lease_expires_at: new Date(now.getTime() + this.getLeaseMs()),
        updated_at: now,
      })
      .where('update_id = :updateId', { updateId: String(updateId) })
      .andWhere('status = :status', {
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
      })
      .andWhere('claim_token = :token', { token })
      .execute();

    if (renewed.affected !== 1) {
      throw new TelegramWebhookClaimOwnershipLostError();
    }
  }

  async assertCurrentExecutionOwnership(): Promise<{
    updateId: number;
    token: string;
  }> {
    const execution = this.execution.getStore();
    if (!execution) throw new TelegramWebhookClaimOwnershipLostError();
    const owned = await this.updates
      .createQueryBuilder('update')
      .where('update.update_id = :updateId', {
        updateId: String(execution.updateId),
      })
      .andWhere('update.status = :status', {
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
      })
      .andWhere('update.claim_token = :token', { token: execution.token })
      .andWhere('update.lease_expires_at > :now', { now: new Date() })
      .getOne();
    if (!owned) throw new TelegramWebhookClaimOwnershipLostError();
    return execution;
  }

  /**
   * Keeps a claim alive while Telegraf runs a potentially long handler.
   *
   * This prevents the normal lease-expiry path from admitting a concurrent
   * retry. It cannot cancel arbitrary handler side effects after a database
   * outage, so callers must still treat Telegram processing as at-least-once.
   */
  async runWhileRenewingLease<T>(
    updateId: number,
    token: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const renewalIntervalMs = Math.max(
      1_000,
      Math.floor(this.getLeaseMs() / 3),
    );
    let timer: NodeJS.Timeout | null = null;
    let pendingRenewal: Promise<void> | null = null;
    let renewalError: unknown;
    let stopped = false;

    const schedule = () => {
      if (stopped || renewalError) return;
      timer = setTimeout(() => {
        pendingRenewal = this.renew(updateId, token)
          .catch((error: unknown) => {
            renewalError =
              error instanceof TelegramWebhookClaimOwnershipLostError
                ? error
                : new TelegramWebhookLeaseRenewalError();
          })
          .finally(() => {
            pendingRenewal = null;
            schedule();
          });
      }, renewalIntervalMs);
      timer.unref?.();
    };

    schedule();
    let result: T;
    try {
      result = await this.execution.run({ updateId, token }, work);
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (pendingRenewal) await pendingRenewal;
    }

    if (renewalError) {
      throw renewalError;
    }
    return result;
  }

  async release(updateId: number, token: string): Promise<void> {
    await this.updates
      .createQueryBuilder()
      .delete()
      .from(TelegramWebhookUpdate)
      .where('update_id = :updateId', { updateId: String(updateId) })
      .andWhere('status = :status', {
        status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
      })
      .andWhere('claim_token = :token', { token })
      .execute();
  }

  private getLeaseMs(): number {
    const configured = Number(
      this.configService.get<string>('TELEGRAM_WEBHOOK_LEASE_MS'),
    );
    if (!Number.isFinite(configured)) return DEFAULT_LEASE_MS;
    return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, configured));
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as {
      code?: string;
      errno?: number;
    };
    return (
      driverError.code === '23505' ||
      driverError.code === 'SQLITE_CONSTRAINT' ||
      driverError.errno === 19
    );
  }
}
