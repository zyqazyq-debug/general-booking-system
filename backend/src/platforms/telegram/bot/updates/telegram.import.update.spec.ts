import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { TelegramImportUpdate } from './telegram.import.update';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { TelegramQrService } from '../services';
import { TelegramErrorNormalizerService } from '../services';
import { TelegramUiService } from '../services';
import { TelegramMessageParserService } from '../services';
import { TelegramImportTextCommandService } from '../services';
import { TelegramImportActionService } from '../services';
import { TelegramSessionStateService } from '../services';
import { TelegramCallbackService } from '../services';
import { Context } from 'telegraf';

describe('TelegramImportUpdate', () => {
  let update: TelegramImportUpdate;
  let importAppService: jest.Mocked<TelegramImportApplicationService>;
  let uiService: jest.Mocked<TelegramUiService>;
  let sessionState: TelegramSessionStateService;
  let callbackService: jest.Mocked<TelegramCallbackService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramImportUpdate,
        {
          provide: TelegramImportApplicationService,
          useValue: {
            preCheckImportContent: jest.fn(),
            importContent: jest.fn(),
          },
        },
        {
          provide: TelegramQrService,
          useValue: {},
        },
        {
          provide: TelegramErrorNormalizerService,
          useValue: {
            extractErrorText: jest.fn().mockReturnValue('mock error'),
            extractQueryErrorCode: jest.fn(),
          },
        },
        {
          provide: TelegramUiService,
          useValue: {
            sendMainKeyboard: jest.fn(),
            sendCollectionCard: jest.fn(),
          },
        },
        {
          provide: TelegramMessageParserService,
          useValue: {
            buildImportFailureMessage: jest
              .fn()
              .mockReturnValue('mock message'),
          },
        },
        {
          provide: TelegramImportTextCommandService,
          useValue: {},
        },
        {
          provide: TelegramImportActionService,
          useValue: {},
        },
        TelegramSessionStateService,
        {
          provide: TelegramCallbackService,
          useValue: {
            answerCbQuerySafely: jest.fn(),
          },
        },
      ],
    }).compile();

    update = module.get<TelegramImportUpdate>(TelegramImportUpdate);
    importAppService = module.get<
      jest.Mocked<TelegramImportApplicationService>
    >(TelegramImportApplicationService);
    uiService = module.get<jest.Mocked<TelegramUiService>>(TelegramUiService);
    sessionState = module.get<TelegramSessionStateService>(
      TelegramSessionStateService,
    );
    callbackService = module.get<jest.Mocked<TelegramCallbackService>>(
      TelegramCallbackService,
    );
  });

  it('should handle confirm_import action and catch exceptions', async () => {
    const token = sessionState.createPendingImport({
      chatId: 123,
      userId: 456,
      content: 'test_content',
      source: 'text',
      ttlMs: 10000,
    });

    const mockCtx = {
      match: [`confirm_import_${token}`, token],
      answerCbQuery: jest.fn().mockResolvedValue(true),
      editMessageText: jest.fn(),
      chat: { id: 123 },
      from: { id: 456 },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    };

    importAppService.importContent.mockRejectedValue(
      new Error('Import failed'),
    );

    await update.onConfirmImport(mockCtx as unknown as Context);

    const callbackCalls = (
      callbackService as unknown as { answerCbQuerySafely: jest.Mock }
    ).answerCbQuerySafely.mock.calls;
    const importCalls = (
      importAppService as unknown as { importContent: jest.Mock }
    ).importContent.mock.calls;
    const keyboardCalls = (
      uiService as unknown as { sendMainKeyboard: jest.Mock }
    ).sendMainKeyboard.mock.calls;

    expect(callbackCalls).toContainEqual([
      mockCtx,
      '正在导入...',
      'import_confirm',
    ]);
    expect(mockCtx.editMessageText).toHaveBeenCalledWith(
      '⏳ 正在执行导入，请稍候...',
    );
    expect(importCalls).toContainEqual([
      {
        chatId: 123,
        telegramUser: mockCtx.from,
        content: 'test_content',
        forceRecreateOnExisting: undefined,
      },
    ]);
    expect(keyboardCalls).toContainEqual([mockCtx, 'mock message']);
  });

  it('should return expired message when pending import is expired', async () => {
    jest.useFakeTimers();
    const token = sessionState.createPendingImport({
      chatId: 123,
      userId: 456,
      content: 'expired_content',
      source: 'text',
      ttlMs: 1,
    });
    jest.advanceTimersByTime(5);

    const mockCtx = {
      match: [`confirm_import_${token}`, token],
      answerCbQuery: jest.fn().mockResolvedValue(true),
      editMessageText: jest.fn(),
      chat: { id: 123 },
      from: { id: 456 },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    };

    await update.onConfirmImport(mockCtx as unknown as Context);

    const callbackCalls = (
      callbackService as unknown as { answerCbQuerySafely: jest.Mock }
    ).answerCbQuerySafely.mock.calls;
    const importCalls = (
      importAppService as unknown as { importContent: jest.Mock }
    ).importContent.mock.calls;
    expect(callbackCalls).toContainEqual([
      mockCtx,
      '请求已过期，请重新发送链接',
      'import_confirm',
    ]);
    expect(mockCtx.editMessageText).toHaveBeenCalledWith(
      '⏳ 导入请求已过期，请重新发送链接。',
    );
    expect(importCalls.length).toBe(0);
    jest.useRealTimers();
  });

  it('should reject invalid confirm token payload', async () => {
    const mockCtx = {
      match: ['confirm_import_', ''],
      answerCbQuery: jest.fn().mockResolvedValue(true),
      editMessageText: jest.fn(),
      chat: { id: 123 },
      from: { id: 456 },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    };

    await update.onConfirmImport(mockCtx as unknown as Context);

    const callbackCalls = (
      callbackService as unknown as { answerCbQuerySafely: jest.Mock }
    ).answerCbQuerySafely.mock.calls;
    expect(callbackCalls).toContainEqual([
      mockCtx,
      '无效请求',
      'import_confirm',
    ]);
  });
});
