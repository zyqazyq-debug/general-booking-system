import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { TelegramWebhookInboxService } from './persistence/telegram-webhook-inbox.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('TelegramWebhookController', () => {
  const secret = 'test_secret';
  let bot: jest.Mocked<Pick<Telegraf<Context>, 'handleUpdate'>>;
  let inbox: jest.Mocked<
    Pick<
      TelegramWebhookInboxService,
      'claim' | 'runWhileRenewingLease' | 'complete' | 'release'
    >
  >;
  let response: { sendStatus: jest.Mock };

  beforeEach(() => {
    bot = { handleUpdate: jest.fn().mockResolvedValue(undefined) };
    inbox = {
      claim: jest
        .fn()
        .mockResolvedValue({ kind: 'claimed', token: 'claim-token' }),
      runWhileRenewingLease: jest
        .fn()
        .mockImplementation(async (_updateId, _token, work) => work()),
      complete: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    response = { sendStatus: jest.fn() };
  });

  function controller(values: Record<string, string | undefined> = {}) {
    return new TelegramWebhookController(
      bot as unknown as Telegraf<Context>,
      config({
        TELEGRAM_ENABLE_WEBHOOK: 'true',
        TELEGRAM_BOT_MODE: 'webhook',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: secret,
        ...values,
      }),
      inbox as unknown as TelegramWebhookInboxService,
    );
  }

  function request(updateId: unknown = 123) {
    return {
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: { update_id: updateId, message: { text: '/start' } },
    };
  }

  it('keeps webhook delivery disabled unless explicitly enabled', async () => {
    await controller({ TELEGRAM_ENABLE_WEBHOOK: 'false' }).receive(
      request() as any,
      response as any,
    );

    expect(response.sendStatus).toHaveBeenCalledWith(503);
    expect(inbox.claim).not.toHaveBeenCalled();
  });

  it('rejects a webhook request without the Telegram secret header', async () => {
    const invalidRequest = request();
    invalidRequest.headers = {} as typeof invalidRequest.headers;

    await controller().receive(invalidRequest as any, response as any);

    expect(response.sendStatus).toHaveBeenCalledWith(403);
    expect(inbox.claim).not.toHaveBeenCalled();
  });

  it('rejects an invalid update_id before claiming it', async () => {
    await controller().receive(request('123') as any, response as any);

    expect(response.sendStatus).toHaveBeenCalledWith(400);
    expect(inbox.claim).not.toHaveBeenCalled();
  });

  it('persists completion before acknowledging a verified update', async () => {
    const verifiedRequest = request();
    await controller().receive(verifiedRequest as any, response as any);

    expect(inbox.claim).toHaveBeenCalledWith(123);
    expect(inbox.runWhileRenewingLease).toHaveBeenCalledWith(
      123,
      'claim-token',
      expect.any(Function),
    );
    expect(bot.handleUpdate).toHaveBeenCalledWith(verifiedRequest.body);
    expect(inbox.complete).toHaveBeenCalledWith(123, 'claim-token');
    expect(response.sendStatus).toHaveBeenCalledWith(200);
    expect(inbox.complete.mock.invocationCallOrder[0]).toBeLessThan(
      response.sendStatus.mock.invocationCallOrder[0],
    );
  });

  it('acknowledges a duplicate without invoking Telegraf', async () => {
    inbox.claim.mockResolvedValue({ kind: 'duplicate' });

    await controller().receive(request() as any, response as any);

    expect(bot.handleUpdate).not.toHaveBeenCalled();
    expect(inbox.complete).not.toHaveBeenCalled();
    expect(response.sendStatus).toHaveBeenCalledWith(200);
  });

  it('asks Telegram to retry while another owner is still processing', async () => {
    inbox.claim.mockResolvedValue({ kind: 'in-flight' });

    await controller().receive(request() as any, response as any);

    expect(bot.handleUpdate).not.toHaveBeenCalled();
    expect(inbox.complete).not.toHaveBeenCalled();
    expect(response.sendStatus).toHaveBeenCalledWith(503);
  });

  it('releases a failed claim and returns 500 so Telegram can retry', async () => {
    bot.handleUpdate.mockRejectedValue(new Error('handler failed'));

    await controller().receive(request() as any, response as any);

    expect(inbox.release).toHaveBeenCalledWith(123, 'claim-token');
    expect(inbox.complete).not.toHaveBeenCalled();
    expect(response.sendStatus).toHaveBeenCalledWith(500);
  });

  it('fails closed when the durable claim cannot be acquired', async () => {
    inbox.claim.mockRejectedValue(new Error('database unavailable'));

    await controller().receive(request() as any, response as any);

    expect(bot.handleUpdate).not.toHaveBeenCalled();
    expect(response.sendStatus).toHaveBeenCalledWith(503);
  });

  it('does not log the raw update or error message on handler failure', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const sensitive = 'raw-user-text-and-secret-token';
    bot.handleUpdate.mockRejectedValue(new Error(sensitive));
    const req = request();
    req.body.message.text = sensitive;

    await controller().receive(req as any, response as any);

    const serializedLogs = JSON.stringify(log.mock.calls);
    expect(serializedLogs).toContain('handler_failed');
    expect(serializedLogs).not.toContain(sensitive);
    log.mockRestore();
  });

  it('returns 503 when completion fails and never acknowledges first', async () => {
    inbox.complete.mockRejectedValue(new Error('database unavailable'));

    await controller().receive(request() as any, response as any);

    expect(response.sendStatus).toHaveBeenCalledTimes(1);
    expect(response.sendStatus).toHaveBeenCalledWith(503);
  });
});
