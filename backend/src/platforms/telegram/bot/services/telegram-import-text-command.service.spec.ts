import { TelegramImportTextCommandService } from './telegram-import-text-command.service';
import { TelegramImportApplicationService } from '../../application/telegram-import.application.service';
import { CommandParserService } from './command-parser.service';
import { TelegramUiService } from './telegram-ui.service';
import { TelegramMessageParserService } from './telegram-message-parser.service';
import { TelegramImportActionService } from './telegram-import-action.service';
import { Context } from 'telegraf';
import type { PlatformSystemConfigPort } from '../../../platform-ports';

describe('TelegramImportTextCommandService', () => {
  it('should not trigger markup update when pending target is expired', async () => {
    const importAppService = {
      resolveCollectionId: jest.fn().mockResolvedValue(''),
      findCollectionById: jest.fn().mockResolvedValue(null),
    } as unknown as TelegramImportApplicationService;
    const commandParser = {
      parseMarkupCommand: jest.fn().mockReturnValue({
        markupType: 'PERCENTAGE',
        markupValue: 30,
      }),
    } as unknown as CommandParserService;
    const uiService = {
      sendPromoteLink: jest.fn(),
      sendEditPrompt: jest.fn(),
    } as unknown as TelegramUiService;
    const messageParser = {
      extractImportInput: jest.fn().mockImplementation((v: string) => v),
    } as unknown as TelegramMessageParserService;
    const actionService = {
      takePendingMarkupTarget: jest.fn().mockReturnValue(''),
    } as unknown as TelegramImportActionService;
    const systemConfigPort = {
      get: jest
        .fn()
        .mockResolvedValue(
          '请先点击收藏卡片的“💰 加价”按钮，再回复数字或百分比。',
        ),
    } as unknown as PlatformSystemConfigPort;

    const service = new TelegramImportTextCommandService(
      importAppService,
      commandParser,
      uiService,
      messageParser,
      actionService,
      systemConfigPort,
    );

    const handleEditPrice = jest.fn();
    const handleImportContent = jest.fn();
    const ctx = { reply: jest.fn() } as unknown as Context;

    await service.handleTextInput({
      ctx,
      next: jest.fn(),
      input: { normalizedText: '30%', repliedCollectionId: '' },
      handleEditPrice,
      handleImportContent,
    });

    expect(handleEditPrice).not.toHaveBeenCalled();
    expect(handleImportContent).not.toHaveBeenCalled();
    expect((ctx as unknown as { reply: jest.Mock }).reply).toHaveBeenCalledWith(
      '请先点击收藏卡片的“💰 加价”按钮，再回复数字或百分比。',
    );
    expect(
      (systemConfigPort as unknown as { get: jest.Mock }).get,
    ).toHaveBeenCalledWith(
      'telegram.markup_orphan_input_hint',
      '请先点击收藏卡片的“💰 加价”按钮，再回复数字或百分比。',
    );
  });
});
