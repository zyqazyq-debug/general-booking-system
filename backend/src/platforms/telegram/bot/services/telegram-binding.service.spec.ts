import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { TelegramBindingTicket } from '../../persistence/telegram-binding-ticket.entity';
import { TelegramBindingService } from './telegram-binding.service';

describe('TelegramBindingService durable tickets', () => {
  let dataSource: DataSource;
  let tickets: Repository<TelegramBindingTicket>;
  const config = {
    get: jest.fn((key: string) =>
      key === 'TELEGRAM_DATA_ENCRYPTION_SECRET'
        ? 'ticket-encryption-secret-at-least-32-bytes'
        : undefined,
    ),
  } as unknown as ConfigService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [TelegramBindingTicket],
      synchronize: true,
    });
    await dataSource.initialize();
    tickets = dataSource.getRepository(TelegramBindingTicket);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('loads and consumes a successful H5 login ticket once after restart', async () => {
    const beforeRestart = new TelegramBindingService(
      config,
      {} as any,
      tickets,
    );
    const token = await beforeRestart.generateLoginToken();
    const result = {
      access_token: 'sensitive-access',
      refresh_token: 'sensitive-refresh',
      user: { id: 'user-1' },
    };
    await beforeRestart.completeToken(token, result);

    const [encrypted] = await tickets.find();
    expect(encrypted).toBeDefined();
    expect(encrypted.token_hash).not.toBe(token);
    expect(encrypted.result_payload).not.toContain('sensitive-access');
    expect(encrypted.result_payload).not.toContain('sensitive-refresh');

    const afterRestart = new TelegramBindingService(config, {} as any, tickets);
    await expect(afterRestart.getTokenStatus(token)).resolves.toEqual({
      status: 'success',
      result,
    });

    await expect(afterRestart.getTokenStatus(token)).resolves.toEqual({
      status: 'expired',
    });
    const [consumed] = await tickets.find();
    expect(consumed.status).toBe('expired');
    expect(consumed.result_payload).toBeNull();
  });

  it('deletes an expired successful ticket before exposing its result', async () => {
    const service = new TelegramBindingService(config, {} as any, tickets);
    const token = await service.generateLoginToken();
    await service.completeToken(token, {
      access_token: 'must-not-be-returned',
    });
    const [stored] = await tickets.find();
    await tickets.update(
      { token_hash: stored.token_hash },
      { expires_at: new Date(Date.now() - 1) },
    );

    const restarted = new TelegramBindingService(config, {} as any, tickets);
    await expect(restarted.getTokenStatus(token)).resolves.toEqual({
      status: 'expired',
    });
    await expect(tickets.count()).resolves.toBe(0);
  });

  it('rejects a stored ticket result with an extra envelope segment', async () => {
    const service = new TelegramBindingService(config, {} as any, tickets);
    const token = await service.generateLoginToken();
    await service.completeToken(token, { access_token: 'encrypted' });
    const stored = await tickets.findOneByOrFail({
      token_hash: (await tickets.find())[0].token_hash,
    });
    await tickets.update(
      { token_hash: stored.token_hash },
      { result_payload: `${stored.result_payload}.ignored` },
    );
    const restarted = new TelegramBindingService(config, {} as any, tickets);
    await expect(restarted.getTokenStatus(token)).rejects.toThrow(
      'encrypted payload is invalid',
    );
  });

  it('consumes a successful in-memory result only once', async () => {
    const service = new TelegramBindingService(config, {} as any);
    const token = await service.generateLoginToken();
    const result = { access_token: 'one-shot', refresh_token: 'one-shot-r' };
    await service.completeToken(token, result);

    await expect(service.getTokenStatus(token)).resolves.toEqual({
      status: 'success',
      result,
    });
    await expect(service.getTokenStatus(token)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('removes an expired successful in-memory ticket before returning status', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const service = new TelegramBindingService(config, {} as any);
      const token = await service.generateLoginToken();
      await service.completeToken(token, { access_token: 'never-return' });
      now.mockReturnValue(61_000);

      await expect(service.getTokenStatus(token)).resolves.toEqual({
        status: 'expired',
      });
      await expect(service.getTokenStatus(token)).resolves.toEqual({
        status: 'not_found',
      });
    } finally {
      now.mockRestore();
    }
  });

  it('uses the configured public bot name when Telegram identity lookup is temporarily unavailable', async () => {
    const service = new TelegramBindingService(
      {
        get: jest.fn((key: string) =>
          key === 'TELEGRAM_BOT_NAME' ? 'happybookingbot' : undefined,
        ),
      } as unknown as ConfigService,
      { telegram: { getMe: jest.fn().mockRejectedValue(new Error('offline')) } } as any,
    );

    await expect(service.getBotDeepLink('lt_ticket')).resolves.toBe(
      'https://t.me/happybookingbot?start=lt_ticket',
    );
  });
});
