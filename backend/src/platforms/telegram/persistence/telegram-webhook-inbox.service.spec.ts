import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { TelegramWebhookInboxService } from './telegram-webhook-inbox.service';
import {
  TELEGRAM_WEBHOOK_UPDATE_PROCESSED,
  TELEGRAM_WEBHOOK_UPDATE_PROCESSING,
  TelegramWebhookUpdate,
} from './telegram-webhook-update.entity';

describe('TelegramWebhookInboxService', () => {
  let dataSource: DataSource;
  let repository: Repository<TelegramWebhookUpdate>;
  let configService: ConfigService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [TelegramWebhookUpdate],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(TelegramWebhookUpdate);
    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  function inbox() {
    return new TelegramWebhookInboxService(repository, configService);
  }

  it('grants only one owner when two processes claim concurrently', async () => {
    const [first, second] = await Promise.all([
      inbox().claim(1001),
      inbox().claim(1001),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['claimed', 'in-flight']);
    expect(await repository.count()).toBe(1);
  });

  it('distinguishes an in-flight retry from a completed duplicate', async () => {
    const first = await inbox().claim(1006);
    expect(first.kind).toBe('claimed');

    await expect(inbox().claim(1006)).resolves.toEqual({
      kind: 'in-flight',
    });
  });

  it('suppresses a completed update after a service restart', async () => {
    const firstProcess = inbox();
    const claim = await firstProcess.claim(1002);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    await firstProcess.complete(1002, claim.token);

    const restartedProcess = inbox();
    await expect(restartedProcess.claim(1002)).resolves.toEqual({
      kind: 'duplicate',
    });
    await expect(
      repository.findOneByOrFail({ update_id: '1002' }),
    ).resolves.toMatchObject({ status: TELEGRAM_WEBHOOK_UPDATE_PROCESSED });
  });

  it('allows a later delivery to retry after handler failure', async () => {
    const firstClaim = await inbox().claim(1003);
    expect(firstClaim.kind).toBe('claimed');
    if (firstClaim.kind !== 'claimed') throw new Error('expected claim');
    await inbox().release(1003, firstClaim.token);

    await expect(inbox().claim(1003)).resolves.toMatchObject({
      kind: 'claimed',
    });
  });

  it('reclaims an abandoned processing row after its lease expires', async () => {
    const firstClaim = await inbox().claim(1004);
    expect(firstClaim.kind).toBe('claimed');
    await repository.update(
      { update_id: '1004' },
      { lease_expires_at: new Date(0) },
    );

    const recovered = await inbox().claim(1004);
    expect(recovered.kind).toBe('claimed');
    await expect(
      repository.findOneByOrFail({ update_id: '1004' }),
    ).resolves.toMatchObject({ status: TELEGRAM_WEBHOOK_UPDATE_PROCESSING });
  });

  it('does not let a stale owner complete or release a reclaimed update', async () => {
    const staleClaim = await inbox().claim(1005);
    expect(staleClaim.kind).toBe('claimed');
    if (staleClaim.kind !== 'claimed') throw new Error('expected claim');
    await repository.update(
      { update_id: '1005' },
      { lease_expires_at: new Date(0) },
    );
    const currentClaim = await inbox().claim(1005);
    expect(currentClaim.kind).toBe('claimed');
    if (currentClaim.kind !== 'claimed') throw new Error('expected claim');

    await expect(inbox().complete(1005, staleClaim.token)).rejects.toThrow(
      'claim ownership was lost',
    );
    await inbox().release(1005, staleClaim.token);
    expect(await repository.countBy({ update_id: '1005' })).toBe(1);

    await inbox().complete(1005, currentClaim.token);
    await expect(
      repository.findOneByOrFail({ update_id: '1005' }),
    ).resolves.toMatchObject({ status: TELEGRAM_WEBHOOK_UPDATE_PROCESSED });
  });

  it('renews a live claim without changing its fencing token', async () => {
    const service = inbox();
    const claim = await service.claim(1007);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    const original = await repository.findOneByOrFail({ update_id: '1007' });

    await repository.update(
      { update_id: '1007' },
      { lease_expires_at: new Date(1) },
    );
    await service.renew(1007, claim.token);

    const renewed = await repository.findOneByOrFail({ update_id: '1007' });
    expect(renewed.claim_token).toBe(claim.token);
    expect(renewed.lease_expires_at.getTime()).toBeGreaterThan(
      original.received_at.getTime(),
    );
  });

  it('rejects lease renewal from a stale owner', async () => {
    const service = inbox();
    const claim = await service.claim(1008);
    expect(claim.kind).toBe('claimed');

    await expect(service.renew(1008, 'stale-token')).rejects.toThrow(
      'claim ownership was lost',
    );
  });

  it('periodically renews the lease while a long handler is running', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-09T00:00:00.000Z'));
    const service = inbox();
    const claim = await service.claim(1009);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    const before = await repository.findOneByOrFail({ update_id: '1009' });
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const running = service.runWhileRenewingLease(
      1009,
      claim.token,
      () => work,
    );
    await jest.advanceTimersByTimeAsync(40_001);

    const during = await repository.findOneByOrFail({ update_id: '1009' });
    expect(during.lease_expires_at.getTime()).toBeGreaterThan(
      before.lease_expires_at.getTime(),
    );
    await expect(service.claim(1009)).resolves.toEqual({ kind: 'in-flight' });
    finish();
    await running;
  });

  it('fails the processing attempt when renewal detects lost ownership', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-09T00:00:00.000Z'));
    const service = inbox();
    const claim = await service.claim(1010);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const running = service.runWhileRenewingLease(
      1010,
      claim.token,
      () => work,
    );
    await repository.update(
      { update_id: '1010' },
      { claim_token: 'replacement-owner-token' },
    );

    await jest.advanceTimersByTimeAsync(40_001);
    finish();

    await expect(running).rejects.toThrow('claim ownership was lost');
  });
});
