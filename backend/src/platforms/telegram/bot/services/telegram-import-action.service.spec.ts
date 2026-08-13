/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { TelegramImportActionService } from './telegram-import-action.service';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { TelegramUiService } from './telegram-ui.service';
import { TelegramErrorNormalizerService } from './telegram-error-normalizer.service';
import { TelegramSessionStateService } from './telegram-session-state.service';
import { TelegramCallbackService } from './telegram-callback.service';
import { Context } from 'telegraf';

type ActionMockContext = Context & {
  match: [string, string];
  answerCbQuery: jest.MockedFunction<
    (text?: string) => Promise<true> | Promise<void>
  >;
  reply: jest.MockedFunction<
    (
      text: string,
      extra?: Record<string, unknown>,
    ) => Promise<true> | Promise<void>
  >;
};

jest.mock('../../application/telegram-import.application.service', () => ({
  TelegramImportApplicationService: class MockTelegramImportApplicationService {},
}));

describe('TelegramImportActionService', () => {
  let service: TelegramImportActionService;
  let importAppService: jest.Mocked<TelegramImportApplicationService>;
  let uiService: jest.Mocked<TelegramUiService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramImportActionService,
        {
          provide: TelegramImportApplicationService,
          useValue: {
            findCollectionById: jest.fn(),
            updateCollectionMarkup: jest.fn(),
          },
        },
        {
          provide: TelegramUiService,
          useValue: {
            sendEditPrompt: jest.fn(),
            sendPromoteLink: jest.fn(),
            sendBookingPrompt: jest.fn(),
            sendCollectionCard: jest.fn(),
          },
        },
        {
          provide: TelegramErrorNormalizerService,
          useValue: {
            extractErrorText: jest
              .fn()
              .mockImplementation(
                (_e: unknown, defaultMsg?: string) => defaultMsg || 'error',
              ),
          },
        },
        TelegramSessionStateService,
        {
          provide: TelegramCallbackService,
          useValue: {
            answerCbQuerySafely: jest.fn(
              async (
                ctx: Pick<Context, 'answerCbQuery'>,
                text?: string,
              ): Promise<void> => {
                if (ctx && typeof ctx.answerCbQuery === 'function') {
                  await ctx.answerCbQuery(text);
                }
              },
            ),
          },
        },
      ],
    }).compile();

    service = module.get<TelegramImportActionService>(
      TelegramImportActionService,
    );
    importAppService = module.get(TelegramImportApplicationService);
    uiService = module.get(TelegramUiService);
  });

  describe('Pending Markup Target State', () => {
    let mockCtx: Context;

    beforeEach(() => {
      mockCtx = {
        chat: { id: 12345 } as Context['chat'],
        from: { id: 67890 } as Context['from'],
      } as Context;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should set and retrieve pending markup target correctly', () => {
      service.setPendingMarkupTarget(mockCtx, 'collection-1');

      const targetId = service.takePendingMarkupTarget(mockCtx);
      expect(targetId?.collectionId).toBe('collection-1');
    });

    it('should return empty string if target does not exist', () => {
      const targetId = service.takePendingMarkupTarget(mockCtx);
      expect(targetId).toBeNull();
    });

    it('should consume the target after retrieval (one-time use)', () => {
      service.setPendingMarkupTarget(mockCtx, 'collection-1');

      const firstRetrieval = service.takePendingMarkupTarget(mockCtx);
      expect(firstRetrieval?.collectionId).toBe('collection-1');

      const secondRetrieval = service.takePendingMarkupTarget(mockCtx);
      expect(secondRetrieval).toBeNull();
    });

    it('should handle expiration of pending targets', () => {
      service.setPendingMarkupTarget(mockCtx, 'collection-1');

      // Advance time by 11 minutes (expires in 10 mins)
      jest.advanceTimersByTime(11 * 60 * 1000);

      const targetId = service.takePendingMarkupTarget(mockCtx);
      expect(targetId).toBeNull();
    });

    it('should not retrieve target for different user/chat', () => {
      service.setPendingMarkupTarget(mockCtx, 'collection-1');

      const otherCtx = {
        chat: { id: 99999 } as Context['chat'],
        from: { id: 67890 } as Context['from'],
      } as Context;

      const targetId = service.takePendingMarkupTarget(otherCtx);
      expect(targetId).toBeNull();
    });
  });

  describe('Action Handling', () => {
    let mockCtx: ActionMockContext;

    beforeEach(() => {
      mockCtx = {
        chat: { id: 12345 } as Context['chat'],
        from: { id: 67890 } as Context['from'],
        match: ['full_match', 'collection-id-123'],
        answerCbQuery: jest
          .fn()
          .mockResolvedValue(true) as ActionMockContext['answerCbQuery'],
        reply: jest.fn().mockResolvedValue(true) as ActionMockContext['reply'],
      } as ActionMockContext;
    });

    it('should handle onEditAction successfully', async () => {
      const findCollectionByIdSpy = jest.spyOn(
        importAppService,
        'findCollectionById',
      );
      const sendEditPromptSpy = jest.spyOn(uiService, 'sendEditPrompt');
      findCollectionByIdSpy.mockResolvedValue({
        id: 'collection-id-123',
        share_slug: 'test-slug',
      } as any);

      await service.onEditAction(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith('正在打开编辑器...');
      expect(sendEditPromptSpy).toHaveBeenCalledWith(mockCtx, {
        id: 'collection-id-123',
      });
    });

    it('should handle onPromoteAction successfully', async () => {
      const findCollectionByIdSpy = jest.spyOn(
        importAppService,
        'findCollectionById',
      );
      const sendPromoteLinkSpy = jest.spyOn(uiService, 'sendPromoteLink');
      findCollectionByIdSpy.mockResolvedValue({
        id: 'collection-id-123',
        share_slug: 'test-slug',
      } as any);

      await service.onPromoteAction(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith('正在生成推广链接...');
      expect(findCollectionByIdSpy).toHaveBeenCalledWith('collection-id-123');
      expect(sendPromoteLinkSpy).toHaveBeenCalled();
    });

    it('should handle onMarkupAction and set pending target', async () => {
      const findCollectionByIdSpy = jest.spyOn(
        importAppService,
        'findCollectionById',
      );
      const sendEditPromptSpy = jest.spyOn(uiService, 'sendEditPrompt');
      findCollectionByIdSpy.mockResolvedValue({
        id: 'collection-id-123',
        share_slug: 'test-slug',
      } as any);
      sendEditPromptSpy.mockResolvedValue({ message_id: 111 } as any);

      await service.onMarkupAction(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith(
        '请在回复框输入加价...',
      );
      // Verify pending target is set
      const targetId = service.takePendingMarkupTarget(mockCtx);
      expect(targetId?.collectionId).toBe('collection-id-123');

      expect(sendEditPromptSpy).toHaveBeenCalled();
    });

    it('should handle onBookAction successfully', async () => {
      const findCollectionByIdSpy = jest.spyOn(
        importAppService,
        'findCollectionById',
      );
      const sendBookingPromptSpy = jest.spyOn(uiService, 'sendBookingPrompt');
      findCollectionByIdSpy.mockResolvedValue({
        id: 'collection-id-123',
      } as any);

      await service.onBookAction(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith('正在打开预约...');
      expect(sendBookingPromptSpy).toHaveBeenCalled();
    });
  });
});
