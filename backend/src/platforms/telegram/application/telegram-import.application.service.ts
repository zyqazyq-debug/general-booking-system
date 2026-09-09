import {
  Injectable,
  NotFoundException,
  Inject,
  Optional,
} from '@nestjs/common';
import { User } from 'telegraf/types';
import { TelegramImportService } from '../bot/services/telegram-import.service';
import { TelegramAuthService } from '../bot/services/telegram-auth.service';
import type { AuthenticatedUser } from '../../../shared/common/types/auth-request.type';
import type { PlatformAgencyPort } from '../../platform-ports';
import { PLATFORM_AGENCY_PORT } from '../../platform-ports';
import type { PlatformAgencyNodeDto } from '../../platform-ports';
import { TelegramWebhookMutationFenceService } from '../persistence/telegram-webhook-mutation-fence.service';

@Injectable()
export class TelegramImportApplicationService {
  constructor(
    @Inject(PLATFORM_AGENCY_PORT)
    private readonly agencyPort: PlatformAgencyPort,
    private readonly importService: TelegramImportService,
    private readonly authService: TelegramAuthService,
    @Optional()
    private readonly mutationFence?: TelegramWebhookMutationFenceService,
  ) {}

  async importContent(params: {
    chatId: number;
    telegramUser?: User;
    content: string;
    forceRecreateOnExisting?: boolean;
    importAsChild?: boolean;
  }): Promise<{
    user: AuthenticatedUser;
    fullNode: PlatformAgencyNodeDto;
    isNew: boolean;
  }> {
    const user = await this.authService.validateBotUser(
      params.chatId,
      params.telegramUser,
    );

    const importCollection = () =>
      this.importService.importCollection(
        params.chatId.toString(),
        user,
        params.content,
        {
          forceRecreateOnExisting: params.forceRecreateOnExisting,
          importAsChild: params.importAsChild,
        },
      );
    const result = this.mutationFence
      ? await this.mutationFence.executeOnce(
          'import_collection',
          `${user.id}:${params.content}:${params.forceRecreateOnExisting === true}:${params.importAsChild === true}`,
          importCollection,
        )
      : await importCollection();

    const fullNode = await this.agencyPort.findOne(result.collectionNode.id);
    if (!fullNode) {
      throw new NotFoundException('Node not found after import');
    }

    return {
      user,
      fullNode,
      isNew: result.isNew,
    };
  }

  async preCheckImportContent(params: {
    chatId: number;
    telegramUser?: User;
    content: string;
  }) {
    const user = await this.authService.validateBotUser(
      params.chatId,
      params.telegramUser,
    );

    const preCheckResult = await this.importService.preCheckImport(
      user,
      params.content,
    );

    return {
      user,
      ...preCheckResult,
    };
  }

  async resolveCollectionId(slugOrId: string): Promise<string> {
    if (/^[a-f0-9-]{36}$/i.test(slugOrId)) {
      return slugOrId;
    }
    try {
      const node = (await this.agencyPort.findBySlug(slugOrId)) as {
        id: string;
      } | null;
      if (node && typeof node.id === 'string') {
        return node.id;
      }
    } catch {
      return '';
    }
    return '';
  }

  async findCollectionById(id: string): Promise<PlatformAgencyNodeDto | null> {
    return this.agencyPort.findOne(id);
  }

  async updateCollectionMarkup(params: {
    chatId: number;
    telegramUser?: User;
    collectionId: string;
    markupType: string;
    markupValue: number;
  }): Promise<PlatformAgencyNodeDto | null> {
    const user = await this.authService.validateBotUser(
      params.chatId,
      params.telegramUser,
    );
    const updateMarkup = () =>
      this.agencyPort.updateCollection(user.id, params.collectionId, {
        markup_type: params.markupType,
        markup_value: params.markupValue,
      });
    return this.mutationFence
      ? this.mutationFence.executeOnce(
          'update_markup',
          `${user.id}:${params.collectionId}:${params.markupType}:${params.markupValue}`,
          updateMarkup,
        )
      : updateMarkup();
  }
}
