import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { TelegramWebhookInboxService } from './telegram-webhook-inbox.service';
import { TelegramWebhookOperation } from './telegram-webhook-operation.entity';
import {
  TelegramMutationReplayBlockedError,
  TelegramWebhookMutationFenceService,
} from './telegram-webhook-mutation-fence.service';
import { TelegramWebhookUpdate } from './telegram-webhook-update.entity';

describe('TelegramWebhookMutationFenceService', () => {
  let dataSource: DataSource;
  let updates: Repository<TelegramWebhookUpdate>;
  let operations: Repository<TelegramWebhookOperation>;
  let inbox: TelegramWebhookInboxService;
  let fence: TelegramWebhookMutationFenceService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [TelegramWebhookUpdate, TelegramWebhookOperation],
      synchronize: true,
    });
    await dataSource.initialize();
    updates = dataSource.getRepository(TelegramWebhookUpdate);
    operations = dataSource.getRepository(TelegramWebhookOperation);
    inbox = new TelegramWebhookInboxService(updates, {
      get: jest.fn(),
    } as unknown as ConfigService);
    fence = new TelegramWebhookMutationFenceService(operations, inbox, {
      get: jest.fn((key: string) =>
        key === 'TELEGRAM_BOT_TOKEN'
          ? '123456:test-secret'
          : key === 'TELEGRAM_DATA_ENCRYPTION_SECRET'
            ? 'test-result-encryption-key-at-least-32-bytes'
            : undefined,
      ),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  async function withClaim<T>(updateId: number, work: () => Promise<T>) {
    const claim = await inbox.claim(updateId);
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    return inbox.runWhileRenewingLease(updateId, claim.token, work);
  }

  it('executes one irreversible write and blocks a completed replay', async () => {
    let writes = 0;
    await withClaim(2001, async () => {
      await fence.executeOnce(
        'import_collection',
        'private-content',
        async () => {
          writes += 1;
        },
      );
      await expect(
        fence.executeOnce('import_collection', 'private-content', async () => {
          writes += 1;
        }),
      ).rejects.toBeInstanceOf(TelegramMutationReplayBlockedError);
    });

    expect(writes).toBe(1);
    await expect(
      operations.findOneByOrFail({ update_id: '2001' }),
    ).resolves.toMatchObject({
      status: 'completed',
      resource_hash: expect.not.stringContaining('private-content'),
    });
  });

  it('allows an explicitly void completed replay without repeating its write', async () => {
    let writes = 0;
    await withClaim(2005, async () => {
      const sync = () => {
        writes += 1;
        return Promise.resolve();
      };
      await fence.executeOnceVoid('sync_telegram_user', 'chat-id', sync);
      await fence.executeOnceVoid('sync_telegram_user', 'chat-id', sync);
    });
    expect(writes).toBe(1);
  });

  it('recovers an encrypted completed result across the ticket completion gap', async () => {
    const loginResult = {
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      user: { id: 'user-1' },
    };
    let logins = 0;
    await withClaim(2006, async () => {
      const first = await fence.executeOnceRecoverable(
        'login_by_deep_link',
        'ticket-identity',
        async () => {
          logins += 1;
          return loginResult;
        },
      );
      expect(first).toEqual({ result: loginResult, replayed: false });

      // Simulates a crash after the operation committed but before the caller
      // completed its H5 ticket. Replay reads the encrypted result instead of
      // creating another auth session.
      const replay = await fence.executeOnceRecoverable(
        'login_by_deep_link',
        'ticket-identity',
        async () => {
          logins += 1;
          return loginResult;
        },
      );
      expect(replay).toEqual({ result: loginResult, replayed: true });
    });
    expect(logins).toBe(1);
    const stored = await operations.findOneByOrFail({ update_id: '2006' });
    expect(stored.result_payload).not.toContain('access-secret');
    expect(stored.result_payload).not.toContain('refresh-secret');
  });

  it('fails closed when a stored recoverable result has a noncanonical envelope', async () => {
    await withClaim(2007, async () => {
      await fence.executeOnceRecoverable(
        'login_by_deep_link',
        'tamper-test',
        async () => ({ access_token: 'encrypted' }),
      );
      const stored = await operations.findOneByOrFail({ update_id: '2007' });
      await operations.update(
        { idempotency_key: stored.idempotency_key },
        { result_payload: `${stored.result_payload}.ignored` },
      );
      await expect(
        fence.executeOnceRecoverable(
          'login_by_deep_link',
          'tamper-test',
          async () => ({ access_token: 'must-not-run' }),
        ),
      ).rejects.toBeInstanceOf(TelegramMutationReplayBlockedError);
    });
  });

  it('keeps a failed attempt fenced so crash replay cannot repeat the write', async () => {
    let writes = 0;
    await withClaim(2002, async () => {
      await expect(
        fence.executeOnce('update_markup', 'node:30', async () => {
          writes += 1;
          throw new Error('simulated crash after write');
        }),
      ).rejects.toThrow('simulated crash');
      await expect(
        fence.executeOnce('update_markup', 'node:30', async () => {
          writes += 1;
        }),
      ).rejects.toBeInstanceOf(TelegramMutationReplayBlockedError);
    });
    expect(writes).toBe(1);
  });

  it('checks an unexpired owner immediately before admitting a write', async () => {
    const claim = await inbox.claim(2003);
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    await updates.update(
      { update_id: '2003' },
      { lease_expires_at: new Date(0) },
    );
    const write = jest.fn(async () => undefined);

    await expect(
      inbox.runWhileRenewingLease(2003, claim.token, () =>
        fence.executeOnce('bind_referral', 'user:referrer', write),
      ),
    ).rejects.toThrow('claim ownership was lost');
    expect(write).not.toHaveBeenCalled();
    expect(await operations.count()).toBe(0);
  });

  it('admits only one concurrent attempt for the same operation key', async () => {
    let writes = 0;
    await withClaim(2004, async () => {
      const results = await Promise.allSettled([
        fence.executeOnce('merge_telegram_account', 'same-users', async () => {
          writes += 1;
        }),
        fence.executeOnce('merge_telegram_account', 'same-users', async () => {
          writes += 1;
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });
    expect(writes).toBe(1);
  });
});
