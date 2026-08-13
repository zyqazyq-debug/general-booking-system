import { TelegramCallbackService } from './telegram-callback.service';
import { TelegramErrorNormalizerService } from './telegram-error-normalizer.service';
import { Context } from 'telegraf';

describe('TelegramCallbackService', () => {
  const buildService = (message: string) => {
    const normalizer = {
      extractErrorText: jest.fn().mockReturnValue(message),
    } as unknown as TelegramErrorNormalizerService;
    return new TelegramCallbackService(normalizer);
  };

  it('should swallow expired callback errors', async () => {
    const service = buildService(
      'query is too old and response timeout expired',
    );
    const ctx = {
      answerCbQuery: jest.fn().mockRejectedValue(new Error('expired')),
      chat: { id: 1 },
      from: { id: 2 },
    } as unknown as Context;

    await expect(
      service.answerCbQuerySafely(ctx, '测试', 'test_scene'),
    ).resolves.toBeUndefined();
  });

  it('should rethrow non-expired callback errors', async () => {
    const service = buildService('network broken');
    const ctx = {
      answerCbQuery: jest.fn().mockRejectedValue(new Error('boom')),
      chat: { id: 1 },
      from: { id: 2 },
    } as unknown as Context;

    await expect(
      service.answerCbQuerySafely(ctx, '测试', 'test_scene'),
    ).rejects.toThrow('boom');
  });
});
